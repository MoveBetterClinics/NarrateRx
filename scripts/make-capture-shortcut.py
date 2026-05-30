#!/usr/bin/env python3
"""
Generates the NarrateRx Capture.shortcut file.

Usage:
    python3 scripts/make-capture-shortcut.py --token cct_YOUR_TOKEN

Output:
    ~/Desktop/NarrateRx Capture.shortcut  (signed, ready to double-click)

Then: right-click the shortcut → Share → Copy iCloud Link
Paste that URL into VITE_SHORTCUT_INSTALL_URL in Vercel.

Design notes (hard-won):
  • Named variables (created by Set Variable) are referenced with
    {'Type': 'Variable', 'VariableName': name}. Using OutputName renders as
    "Unknown Variable" in Shortcuts.
  • Each producing action carries an explicit UUID, and the Set Variable that
    captures it wires WFInput to that action's output as
    {'Type': 'ActionOutput', 'OutputUUID': uuid, 'OutputName': label}. Relying
    on the implicit input chain showed "to Input" (the shortcut's own input,
    which is empty) and broke the data flow.
  • The "Get Dictionary Value" action identifier is
    is.workflow.actions.getvalueforkey (NOT getdictionaryvalue).
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


def named_var(name):
    """Full-attachment reference to a NAMED variable (from Set Variable)."""
    return {
        'Value': {'Type': 'Variable', 'VariableName': name},
        'WFSerializationType': 'WFTextTokenAttachment',
    }


def named_var_inline(name):
    """Inline (within-a-string) reference to a NAMED variable."""
    return {
        'Value': {
            'attachmentsByRange': {'{0, 1}': {'Type': 'Variable', 'VariableName': name}},
            'string': '￼',
        },
        'WFSerializationType': 'WFTextTokenString',
    }


def prefix_named_var(prefix, name):
    """Inline text like "Bearer <var>" — literal prefix + named variable."""
    start = len(prefix)
    return {
        'Value': {
            'attachmentsByRange': {
                f'{{{start}, 1}}': {'Type': 'Variable', 'VariableName': name},
            },
            'string': prefix + '￼',
        },
        'WFSerializationType': 'WFTextTokenString',
    }


def action_output(out_uuid, label):
    """Full-attachment reference to a specific action's output (magic var)."""
    return {
        'Value': {'Type': 'ActionOutput', 'OutputUUID': out_uuid, 'OutputName': label},
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


# ── producing actions (carry an explicit UUID + output label) ────────────────

def a_take_video(out_uuid):
    # Param keys verified against electrikmilk/cherri actions/media.cherri:
    # WFCameraCaptureDevice (Front/Back), WFCameraCaptureQuality (Low/Medium/High),
    # WFRecordingStart (On Tap/Immediately).
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.takevideo',
        'WFWorkflowActionParameters': {
            'UUID': out_uuid,
            'CustomOutputName': 'Recorded Video',
            'WFCameraCaptureDevice': 'Back',
            'WFCameraCaptureQuality': 'High',
            # 'On Tap' (not 'Immediately') — Immediately misfires on the Mac
            # webcam (opens showing Stop but isn't recording). On Tap is
            # predictable on both Mac and iPhone: tap record → tap stop.
            'WFRecordingStart': 'On Tap',
        },
    }


def a_take_photo(out_uuid):
    # WFPhotoCount, WFCameraCaptureShowPreview (verified in media.cherri).
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.takephoto',
        'WFWorkflowActionParameters': {
            'UUID': out_uuid,
            'CustomOutputName': 'Taken Photo',
            'WFPhotoCount': 1,
            'WFCameraCaptureShowPreview': True,
        },
    }


def a_select_photos(out_uuid, videos=True):
    # Select Photos has no media-type filter param (only WFSelectMultiplePhotos);
    # the menu branch sets the matching contentType. `videos` is accepted for
    # call-site readability but unused.
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.selectphoto',
        'WFWorkflowActionParameters': {
            'UUID': out_uuid,
            'CustomOutputName': 'Selected Media',
            'WFSelectMultiplePhotos': False,
        },
    }


def a_text(out_uuid, s):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {
            'UUID': out_uuid,
            'CustomOutputName': 'Content Type Text',
            'WFTextActionText': text_token(s),
        },
    }


def a_get_dict_value(out_uuid, key, dict_var):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.getvalueforkey',
        'WFWorkflowActionParameters': {
            'UUID': out_uuid,
            'CustomOutputName': f'{key} value',
            'WFDictionaryKey': text_token(key),
            'WFGetDictionaryValueType': 'Value',
            'WFInput': named_var(dict_var),
        },
    }


def a_http_post_json(out_uuid, url_str, header_pairs, body_pairs):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
        'WFWorkflowActionParameters': {
            'UUID': out_uuid,
            'CustomOutputName': 'API Response',
            'WFURL': text_token(url_str),
            'WFHTTPMethod': 'POST',
            'WFHTTPBodyType': 'JSON',
            'WFHTTPHeaders': dict_value(header_pairs),
            'WFJSONValues': dict_value(body_pairs),
        },
    }


def a_http_put_file(out_uuid, url_value, header_pairs, file_var):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
        'WFWorkflowActionParameters': {
            'UUID': out_uuid,
            'CustomOutputName': 'Upload Response',
            'WFURL': url_value,
            'WFHTTPMethod': 'PUT',
            'WFHTTPBodyType': 'File',
            'WFHTTPHeaders': dict_value(header_pairs),
            'WFRequestVariable': named_var(file_var),
        },
    }


# ── consuming / control actions ──────────────────────────────────────────────

def a_set_var_from_output(name, src_uuid, src_label):
    """Set a named variable to a specific action's output (explicit wiring)."""
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.setvariable',
        'WFWorkflowActionParameters': {
            'WFVariableName': name,
            'WFInput': action_output(src_uuid, src_label),
        },
    }


def a_notify(title, body):
    return {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.notification',
        'WFWorkflowActionParameters': {
            'WFNotificationActionTitle': title,
            'WFNotificationActionBody': body,
        },
    }


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

def capture_case(actions, menu_id, title, capture_action_fn, content_type):
    """One menu branch: capture media → set Media; set ContentType text."""
    actions.append(a_menu_case(menu_id, title))

    media_uuid = uid()
    actions.append(capture_action_fn(media_uuid))
    actions.append(a_set_var_from_output('Media', media_uuid, 'Captured Media'))

    ct_uuid = uid()
    actions.append(a_text(ct_uuid, content_type))
    actions.append(a_set_var_from_output('ContentType', ct_uuid, 'Content Type Text'))


def build(token):
    bearer = f'Bearer {token}'
    menu_id = uid()
    actions = []

    actions.append(a_menu_start(menu_id, 'What do you want to capture?', [
        'Record video', 'Take photo', 'Pick video', 'Pick photo',
    ]))

    capture_case(actions, menu_id, 'Record video',
                 a_take_video, 'video/quicktime')
    capture_case(actions, menu_id, 'Take photo',
                 a_take_photo, 'image/jpeg')
    capture_case(actions, menu_id, 'Pick video',
                 lambda u: a_select_photos(u, videos=True), 'video/quicktime')
    capture_case(actions, menu_id, 'Pick photo',
                 lambda u: a_select_photos(u, videos=False), 'image/jpeg')

    actions.append(a_menu_end(menu_id))

    # Step 1 — get upload URL
    upload_info_uuid = uid()
    actions.append(a_http_post_json(
        upload_info_uuid,
        'https://narraterx.ai/api/capture/upload-url',
        header_pairs=[
            ('Authorization', text_token(bearer)),
            ('Content-Type', text_token('application/json')),
        ],
        body_pairs=[
            ('filename', text_token('capture.mov')),
            ('contentType', named_var_inline('ContentType')),
        ],
    ))
    actions.append(a_set_var_from_output('UploadInfo', upload_info_uuid, 'API Response'))

    # Step 1b — pull fields out of the JSON response
    for key, varname in [('uploadUrl', 'UploadUrl'),
                         ('clientToken', 'ClientToken'),
                         ('blobPathname', 'BlobPathname')]:
        gv_uuid = uid()
        actions.append(a_get_dict_value(gv_uuid, key, 'UploadInfo'))
        actions.append(a_set_var_from_output(varname, gv_uuid, f'{key} value'))

    # Step 2 — upload the media directly to Vercel Blob
    put_uuid = uid()
    actions.append(a_http_put_file(
        put_uuid,
        # WFURL is a TEXT field — a variable must be embedded via the inline
        # string-token form, NOT a bare attachment (which renders as an empty
        # "URL" pill). Attachment form is only for object fields like WFInput /
        # WFRequestVariable (the File).
        url_value=named_var_inline('UploadUrl'),
        header_pairs=[
            ('Authorization', prefix_named_var('Bearer ', 'ClientToken')),
            ('x-api-version', text_token('12')),
            ('x-vercel-blob-access', text_token('public')),
            ('x-content-type', named_var_inline('ContentType')),
        ],
        file_var='Media',
    ))

    # Step 3 — register the upload. capturedAt omitted on purpose; the endpoint
    # defaults it to now() server-side (within seconds of capture here).
    reg_uuid = uid()
    actions.append(a_http_post_json(
        reg_uuid,
        'https://narraterx.ai/api/capture/register',
        header_pairs=[
            ('Authorization', text_token(bearer)),
            ('Content-Type', text_token('application/json')),
        ],
        body_pairs=[
            ('blobPathname', named_var_inline('BlobPathname')),
            ('filename', text_token('capture.mov')),
            ('contentType', named_var_inline('ContentType')),
        ],
    ))

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
    # servers (mode=anyone). Apple's signing endpoint is occasionally flaky
    # (HTTP 500) — retry a few times.
    last_err = ''
    for attempt in range(4):
        sign = subprocess.run(
            ['shortcuts', 'sign', '--mode', 'anyone',
             '--input', str(unsigned), '--output', str(out)],
            capture_output=True, text=True,
        )
        if sign.returncode == 0:
            print(f'✓  {out}  (signed)')
            print()
            print('Next steps:')
            print('  1. Double-click the file to import into Shortcuts')
            print('  2. Right-click the shortcut → Share → Copy iCloud Link')
            print('  3. Paste that URL into VITE_SHORTCUT_INSTALL_URL in Vercel env vars')
            return
        last_err = sign.stderr or sign.stdout

    print(f'shortcuts sign failed after retries: {last_err}')
    print('(The unsigned file is at: ' + str(unsigned) + ')')
    sys.exit(1)


if __name__ == '__main__':
    main()
