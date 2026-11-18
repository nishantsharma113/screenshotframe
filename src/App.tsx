import { Navigate, Route, Routes } from 'react-router-dom';
import { Billing } from '@/pages/Billing';
import { Editor } from '@/pages/Editor';
import { Landing } from '@/pages/Landing';
import { Projects } from '@/pages/Projects';
import { SignIn } from '@/pages/SignIn';
import { Templates } from '@/pages/Templates';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/templates" element={<Templates />} />
      <Route path="/editor" element={<Navigate to="/editor/new" replace />} />
      <Route path="/editor/:id" element={<Editor />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/account/billing" element={<Billing />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
