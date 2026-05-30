#!/usr/bin/env python3
"""
Generates the NarrateRx Capture.shortcut file.

Usage:
    python3 scripts/make-capture-shortcut.py --token cct_YOUR_TOKEN

Output:
    ~/Desktop/NarrateRx Capture.shortcut

Double-click the output file to import into Shortcuts.
Then: right-click the shortcut → Share → Copy iCloud Link
Paste that URL into VITE_SHORTCUT_INSTALL_URL in Vercel.
"""

import plistlib
import uuid
import sys
import argparse
import subprocess
from pathlib import Path


def uid():
    return str(uuid.uuid4()).upper()


# ── plist value helpers ──────────────────────────────────────────────────────

def text_token(s):
    """Plain text value with no variable references."""
    return {
        'Value': {'string': s},
        'WFSerializationType': 'WFTextTokenString',
    }


def var_token(name):
    """Reference a named variable inline (single token replacement)."""
    return {
        'Value': {
            'attachmentsByRange': {
                '{0, 1}': {'OutputName': name, 'Type': 'Variable'},
            },
            'string': '￼',
        },
        'WFSerializationType': 'WFTextTokenString',
    }


def prefix_var_token(prefix, name):
    """Text like "Bearer <var>" — prefix is literal, var is substituted."""
    start = len(prefix)
    return {
        'Value': {
            'attachmentsByRange': {
                f'{{{start}, 1}}': {'OutputName': name, 'Type': 'Variable'},
            },
            'string': prefix + '￼',
        },
        'WFSerializationType': 'WFTextTokenString',
    }


def var_attachment(name):
    """Variable reference used as a full action input (not inside a string)."""
    return {
        'Value': {'OutputName': name, 'Type': 'Variable'},
        'WFSerializationType': 'WFTextTokenAttachment',
    }


def dict_value(pairs):
    """WFDictionaryFieldValue from a list of (key_str, value_token) pairs."""
    items = [
        {'WFItemType': 0, 'WFKey': text_token(k), 'WFValue': v}
        for k, v in pairs
    ]
    return {
        'Value': {'WFDictionaryFieldValueItems': items},
        'WFSerializationType': 'WFDictionaryFieldValue',
    }


# ── individual actions ───────────────────────────────────────────────────────

def a_take_video():
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.takevideo',
        'WFWorkflowActionParameters': {
            'WFCameraPosition': 'Back',
            'WFVideoQuality': 'High',
            'WFRecordingStart': 'Immediately',
        },
    }


def a_take_photo():
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.takephoto',
        'WFWorkflowActionParameters': {
            'WFCameraPosition': 'Back',
            'WFPhotoCount': 1,
            'WFShouldShowCamera': True,
        },
    }


def a_select_photos(videos=True):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.selectphoto',
        'WFWorkflowActionParameters': {
            'WFSelectMultiplePhotos': False,
            'WFSelectMediaType': 'Videos' if videos else 'Images',
        },
    }


def a_text(s):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {'WFTextActionText': text_token(s)},
    }


def a_set_var(name):
    """Set named variable to output of the immediately preceding action."""
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.setvariable',
        'WFWorkflowActionParameters': {'WFVariableName': name},
    }


def a_get_dict_value(key, dict_var):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.getvalueforkey',
        'WFWorkflowActionParameters': {
            'WFDictionaryKey': text_token(key),
            'WFGetDictionaryValueType': 'Value',
            'WFInput': var_attachment(dict_var),
        },
    }


def a_current_date():
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.date',
        'WFWorkflowActionParameters': {},
    }


def a_format_date_iso():
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.formatdate',
        'WFWorkflowActionParameters': {
            'WFDateFormatStyle': 'Custom',
            'WFDateFormat': "yyyy-MM-dd'T'HH:mm:ssZZZZZ",
        },
    }


def a_http_post_json(url_str, header_pairs, body_pairs):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
        'WFWorkflowActionParameters': {
            'WFURL': text_token(url_str),
            'WFHTTPMethod': 'POST',
            'WFHTTPBodyType': 'JSON',
            'WFHTTPHeaders': dict_value(header_pairs),
            'WFHTTPRequestBodyValues': dict_value(body_pairs),
            'WFShowHeaders': False,
        },
    }


def a_http_put_file(url_var, header_pairs, file_var):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
        'WFWorkflowActionParameters': {
            'WFURL': var_token(url_var),
            'WFHTTPMethod': 'PUT',
            'WFHTTPBodyType': 'File',
            'WFHTTPHeaders': dict_value(header_pairs),
            'WFInput': var_attachment(file_var),
            'WFShowHeaders': False,
        },
    }


def a_notify(title, body):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.notification',
        'WFWorkflowActionParameters': {
            'WFNotificationActionTitle': title,
            'WFNotificationActionBody': body,
            'WFNotificationActionSound': True,
        },
    }


# ── menu control flow ────────────────────────────────────────────────────────

def a_menu_start(group_id, prompt, items):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.choosefrommenu',
        'WFWorkflowActionParameters': {
            'WFControlFlowMode': 0,
            'GroupingIdentifier': group_id,
            'WFMenuPrompt': prompt,
            'WFMenuItems': items,
        },
    }


def a_menu_case(group_id, title):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.choosefrommenu',
        'WFWorkflowActionParameters': {
            'WFControlFlowMode': 1,
            'GroupingIdentifier': group_id,
            'WFMenuItemTitle': title,
        },
    }


def a_menu_end(group_id):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.choosefrommenu',
        'WFWorkflowActionParameters': {
            'WFControlFlowMode': 2,
            'GroupingIdentifier': group_id,
        },
    }


# ── assemble ─────────────────────────────────────────────────────────────────

def build(token):
    bearer = f'Bearer {token}'
    menu_id = uid()
    actions = []

    # Menu
    actions.append(a_menu_start(menu_id, 'What do you want to capture?', [
        'Record video', 'Take photo', 'Pick video', 'Pick photo',
    ]))

    actions.append(a_menu_case(menu_id, 'Record video'))
    actions.append(a_take_video())
    actions.append(a_set_var('Media'))
    actions.append(a_text('video/quicktime'))
    actions.append(a_set_var('ContentType'))

    actions.append(a_menu_case(menu_id, 'Take photo'))
    actions.append(a_take_photo())
    actions.append(a_set_var('Media'))
    actions.append(a_text('image/jpeg'))
    actions.append(a_set_var('ContentType'))

    actions.append(a_menu_case(menu_id, 'Pick video'))
    actions.append(a_select_photos(videos=True))
    actions.append(a_set_var('Media'))
    actions.append(a_text('video/quicktime'))
    actions.append(a_set_var('ContentType'))

    actions.append(a_menu_case(menu_id, 'Pick photo'))
    actions.append(a_select_photos(videos=False))
    actions.append(a_set_var('Media'))
    actions.append(a_text('image/jpeg'))
    actions.append(a_set_var('ContentType'))

    actions.append(a_menu_end(menu_id))

    # Get upload URL
    actions.append(a_http_post_json(
        'https://narraterx.ai/api/capture/upload-url',
        header_pairs=[
            ('Authorization', text_token(bearer)),
            ('Content-Type', text_token('application/json')),
        ],
        body_pairs=[
            ('filename', text_token('capture.mov')),
            ('contentType', var_token('ContentType')),
        ],
    ))
    actions.append(a_set_var('UploadInfo'))

    # Extract fields
    actions.append(a_get_dict_value('uploadUrl', 'UploadInfo'))
    actions.append(a_set_var('UploadUrl'))

    actions.append(a_get_dict_value('clientToken', 'UploadInfo'))
    actions.append(a_set_var('ClientToken'))

    actions.append(a_get_dict_value('blobPathname', 'UploadInfo'))
    actions.append(a_set_var('BlobPathname'))

    # Upload directly to Vercel Blob
    actions.append(a_http_put_file(
        url_var='UploadUrl',
        header_pairs=[
            ('Authorization', prefix_var_token('Bearer ', 'ClientToken')),
            ('x-api-version', text_token('12')),
            ('x-vercel-blob-access', text_token('public')),
            ('x-content-type', var_token('ContentType')),
        ],
        file_var='Media',
    ))

    # Timestamp
    actions.append(a_current_date())
    actions.append(a_format_date_iso())
    actions.append(a_set_var('CapturedAt'))

    # Register
    actions.append(a_http_post_json(
        'https://narraterx.ai/api/capture/register',
        header_pairs=[
            ('Authorization', text_token(bearer)),
            ('Content-Type', text_token('application/json')),
        ],
        body_pairs=[
            ('blobPathname', var_token('BlobPathname')),
            ('filename', text_token('capture.mov')),
            ('contentType', var_token('ContentType')),
            ('capturedAt', var_token('CapturedAt')),
        ],
    ))

    # Done
    actions.append(a_notify('NarrateRx', 'Uploaded ✓'))

    return {
        'WFWorkflowActions': actions,
        'WFWorkflowClientVersion': '1140.5',
        'WFWorkflowHasShortcutInputVariables': False,
        'WFWorkflowImportQuestions': [],
        'WFWorkflowInputContentItemClasses': [],
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': [],
        'WFWorkflowIcon': {
            'WFWorkflowIconStartColor': 431817727,
            'WFWorkflowIconGlyphNumber': 59511,
        },
    }


def main():
    p = argparse.ArgumentParser(description='Generate NarrateRx Capture.shortcut')
    p.add_argument('--token', required=True, help='Your capture upload token (cct_...)')
    args = p.parse_args()

    if not args.token.startswith('cct_'):
        print('Error: token must start with cct_  — generate one at /capture in the app.')
        sys.exit(1)

    data = build(args.token)

    xml_tmp = Path('/tmp/narraterx_capture.plist')
    unsigned = Path('/tmp/NarrateRx Capture (unsigned).shortcut')
    out = Path.home() / 'Desktop' / 'NarrateRx Capture.shortcut'

    with open(xml_tmp, 'wb') as f:
        plistlib.dump(data, f, fmt=plistlib.FMT_XML)

    result = subprocess.run(
        ['plutil', '-convert', 'binary1', str(xml_tmp), '-o', str(unsigned)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f'plutil error: {result.stderr}')
        sys.exit(1)

    # macOS refuses to import unsigned .shortcut files. Sign against Apple's
    # servers so the file imports with a double-click. Requires network.
    sign = subprocess.run(
        ['shortcuts', 'sign', '--mode', 'anyone',
         '--input', str(unsigned), '--output', str(out)],
        capture_output=True, text=True,
    )
    if sign.returncode != 0:
        print(f'shortcuts sign error: {sign.stderr or sign.stdout}')
        print('(The unsigned file is at: ' + str(unsigned) + ')')
        sys.exit(1)

    print(f'✓  {out}  (signed)')
    print()
    print('Next steps:')
    print('  1. Double-click the file to import into Shortcuts')
    print('  2. Right-click the shortcut → Share → Copy iCloud Link')
    print('  3. Paste that URL into VITE_SHORTCUT_INSTALL_URL in Vercel env vars')


if __name__ == '__main__':
    main()
