import AuthGate from './AuthGate.jsx'
import LeagueHQ from './LeagueHQ.jsx'

export default function App() {
  return (
    <AuthGate>
      {(session) => <LeagueHQ user={session.user} onSignOut={session.signOut} />}
    </AuthGate>
  )
}
