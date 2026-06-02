/**
 * App — the top-level surface switch. Two views (store.view):
 *   - 'dashboard': the library home (Dashboard).
 *   - 'slicer':    the dark studio workspace (top bar + left sidebar rails +
 *                  the active pipeline step in the working column).
 *
 * Everything is the dark Electric-Blue studio: void-black surfaces, hairline
 * borders, the one accent, system fonts. The slicer holds the package management
 * sidebar (SAVED SLICES + PACKAGES) alongside the step machine.
 */
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { StepRail } from './components/StepRail';
import { ErrorBanner, BusyBanner } from './components/Banners';
import { Toast } from './components/Toast';
import { Dashboard } from './components/Dashboard';
import { Dropzone } from './components/Dropzone';
import { TrimStep } from './steps/TrimStep';
import { ReviewStep } from './steps/ReviewStep';
import { CleanStep } from './steps/CleanStep';
import { ExportStep } from './steps/ExportStep';
import { useStore } from './state/store';

function CurrentStep() {
  const { state } = useStore();
  switch (state.step) {
    case 'upload':
      return <Dropzone />;
    case 'trim':
      return <TrimStep />;
    case 'review':
      return <ReviewStep />;
    case 'clean':
      return <CleanStep />;
    case 'export':
      return <ExportStep />;
    default:
      return <Dropzone />;
  }
}

function Slicer() {
  const { state } = useStore();
  // Before a job exists (fresh "New Slice"), show only the uploader full-width.
  const hasJob = state.job !== null;
  return (
    <div className="app-shell">
      <Header />
      {hasJob ? (
        <div className="workspace fade-in">
          <Sidebar />
          <main className="app-main">
            <StepRail />
            <div className="stack">
              <BusyBanner />
              <ErrorBanner />
              <CurrentStep />
            </div>
          </main>
        </div>
      ) : (
        <main className="dash fade-in">
          <BusyBanner />
          <ErrorBanner />
          <CurrentStep />
        </main>
      )}
    </div>
  );
}

export function App() {
  const { state } = useStore();
  return (
    <>
      {state.view === 'dashboard' ? <Dashboard /> : <Slicer />}
      <Toast />
    </>
  );
}
