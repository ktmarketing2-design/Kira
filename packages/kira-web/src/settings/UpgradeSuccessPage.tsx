import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../lib/api.js";

export default function UpgradeSuccessPage() {
  const [tier, setTier] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ tier: string }>("GET", "/payments/subscription")
      .then((res) => setTier(res.tier))
      .catch(() => setTier(null));
  }, []);

  return (
    <div className="max-w-md mx-auto text-center py-16">
      <div className="text-tt-green text-3xl mb-4">✅</div>
      <h1 className="font-display uppercase text-lg text-tt-fg mb-2">Upgrade successful!</h1>
      <p className="text-tt-fg-dim text-sm mb-6">
        You are now on the {tier ? tier.toUpperCase() : "new"} plan.
      </p>
      <Link
        to="/dashboard"
        className="inline-block bg-tt-brand text-tt-bg rounded-md px-4 py-2 text-sm font-medium"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}
