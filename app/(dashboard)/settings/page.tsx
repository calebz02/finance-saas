import { isPlaidEnabled } from "@/server/feature-flags";

import { SettingsCard } from "./settings-card";

// Read ENABLE_PLAID per request, like the API guard, instead of baking it in at build time.
export const dynamic = "force-dynamic";

const SettingsPage = () => {
  return ( 
    <div className="max-w-screen-2xl mx-auto w-full pb-10 -mt-24">
      <SettingsCard plaidEnabled={isPlaidEnabled()} />
    </div>
  );
};
 
export default SettingsPage;
