import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getToken } from "../lib/api";
import { me } from "../lib/auth";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = getToken();
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!token) {
        if (mounted) { setOk(false); setLoading(false); }
        return;
      }
      try {
        await me();
        if (mounted) setOk(true);
      } catch {
        if (mounted) setOk(false);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [token]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!token || !ok) return <Navigate to="/login" replace />;
  return <>{children}</>;
}