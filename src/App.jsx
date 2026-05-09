import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignIn,
  useUser,
} from '@clerk/clerk-react'
import Layout from '@/components/Layout'
import Dashboard from '@/pages/Dashboard'
import NewInterview from '@/pages/NewInterview'
import InterviewSession from '@/pages/InterviewSession'
import InterviewOutput from '@/pages/InterviewOutput'
import ClinicianProfile from '@/pages/ClinicianProfile'
import Strategy from '@/pages/Strategy'
import ContentHub from '@/pages/ContentHub'
import ReviewPost from '@/pages/ReviewPost'
import ContentCalendar from '@/pages/ContentCalendar'
import MediaHub from '@/pages/MediaHub'
import Integrations from '@/pages/Integrations'
import { workspace } from '@/lib/workspace'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
const ALLOWED_DOMAIN = workspace.authDomain

function DomainGuard({ children }) {
  const { user } = useUser()
  const email = user?.primaryEmailAddress?.emailAddress ?? ''
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm text-center space-y-3 p-8 border rounded-xl shadow-sm">
          <div className="text-2xl">🚫</div>
          <h2 className="font-semibold text-lg">Access Restricted</h2>
          <p className="text-sm text-muted-foreground">
            This app is only available to <strong>@{ALLOWED_DOMAIN}</strong> accounts.
            You're signed in as <span className="font-mono text-xs">{email}</span>.
          </p>
          <button
            onClick={() => window.Clerk?.signOut()}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Sign out and try a different account
          </button>
        </div>
      </div>
    )
  }
  return children
}

function ProtectedApp() {
  return (
    <>
      <SignedIn>
        <DomainGuard>
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/new" element={<NewInterview />} />
              <Route path="/interview/:clinicianId/:interviewId" element={<InterviewSession />} />
              <Route path="/output/:clinicianId/:interviewId" element={<InterviewOutput />} />
              <Route path="/clinician/:clinicianId" element={<ClinicianProfile />} />
              <Route path="/strategy" element={<Strategy />} />
              <Route path="/hub" element={<ContentHub />} />
              <Route path="/review/:itemId" element={<ReviewPost />} />
              <Route path="/calendar" element={<ContentCalendar />} />
              <Route path="/media" element={<MediaHub />} />
              <Route path="/settings/integrations" element={<Integrations />} />
            </Routes>
          </Layout>
        </DomainGuard>
      </SignedIn>

      <SignedOut>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-full max-w-md">
            <div className="text-center mb-6">
              <h1 className="text-xl font-bold">{workspace.name}</h1>
              <p className="text-sm text-muted-foreground">{workspace.signInBlurb}</p>
            </div>
            <SignIn
              appearance={{
                elements: {
                  rootBox: 'mx-auto',
                  card: 'shadow-sm border',
                },
              }}
            />
          </div>
        </div>
      </SignedOut>
    </>
  )
}

export default function App() {
  useEffect(() => {
    document.title = workspace.appName
  }, [])

  if (!PUBLISHABLE_KEY) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Missing <code>VITE_CLERK_PUBLISHABLE_KEY</code> environment variable.
        </p>
      </div>
    )
  }

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <BrowserRouter>
        <ProtectedApp />
      </BrowserRouter>
    </ClerkProvider>
  )
}
