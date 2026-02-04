import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useState } from "react";
import BlueprintReviewPage from "./pages/BlueprintReviewPage";

function Home() {
  const [projectId, setProjectId] = useState("");
  const navigate = useNavigate();
  return (
    <section>
      <h1>NexSupply Internal Review</h1>
      <p>Enter project ID to open Blueprint Review (admin/system only).</p>
      <input
        type="text"
        placeholder="Project ID (UUID)"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
      />
      <button
        type="button"
        onClick={() => projectId.trim() && navigate(`/internal/projects/${projectId.trim()}`)}
      >
        Open Blueprint Review
      </button>
    </section>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/internal/projects/:projectId" element={<BlueprintReviewPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
