import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout';
import { ProtectedRoute } from './components/protected-route';
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { CvUploadPage } from './pages/cv-upload';
import { JobsPage } from './pages/jobs';

/**
 * Top-level routing. Authenticated routes share Layout (header + content).
 * The login page stands alone (no header).
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/cv" element={<CvUploadPage />} />
        <Route path="/jobs" element={<JobsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
