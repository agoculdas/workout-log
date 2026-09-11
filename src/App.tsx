import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import TabBar from './components/TabBar';
import UpdateToast from './components/UpdateToast';
import Today from './screens/Today';
import Session from './screens/Session';
import History from './screens/History';
import ExerciseHistory from './screens/ExerciseHistory';
import Programme from './screens/Programme';
import SettingsScreen from './screens/Settings';

/**
 * Remount Session when the id changes: the screen holds per-session state
 * (current exercise, unsaved drafts, whether the overview sheet is open) and
 * React Router would otherwise reuse the same instance for the next session.
 */
function SessionRoute() {
  const { id } = useParams<{ id: string }>();
  return <Session key={id} />;
}

function Shell() {
  const location = useLocation();
  const inSession = location.pathname.startsWith('/session/');

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <main className={['mx-auto w-full max-w-md', inSession ? 'pb-8' : 'pb-28'].join(' ')}>
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/session/:id" element={<SessionRoute />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:exerciseId" element={<ExerciseHistory />} />
          <Route path="/programme" element={<Programme />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {inSession ? null : <TabBar />}
      <UpdateToast />
    </div>
  );
}

/**
 * HashRouter keeps deep links working on any static host (and inside the
 * installed PWA) without server rewrites, which suits `base: './'`.
 */
export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

export default App;
