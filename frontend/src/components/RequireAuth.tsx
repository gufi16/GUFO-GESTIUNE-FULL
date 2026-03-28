import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getToken } from "../lib/api";
import { me } from "../lib/auth";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = getToken();
  const [loading, setLoading] = useState(true);
  const [ok, setOk] = useState(false);
  const [, setModuleStamp] = useState("");

  useEffect(() => {
    let mounted = true;
    const loadProfile = async () => {
      if (!token) {
        if (mounted) {
          setOk(false);
          setLoading(false);
        }
        return;
      }
      try {
        const profile = await me();
        const modules = Array.isArray((profile as any)?.modules) ? (profile as any).modules : []
        localStorage.setItem("modules", JSON.stringify(modules))
        if (mounted) {
          setModuleStamp(modules.join("|"))
        }
        if (mounted) setOk(true);
      } catch {
        if (mounted) setOk(false);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadProfile()

    const onFocus = () => {
      loadProfile()
    }

    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onFocus)

    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onFocus)
      mounted = false;
    };
  }, [token]);

  if (loading) return <div className="p-6">Loading...</div>;
  if (!token || !ok) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
