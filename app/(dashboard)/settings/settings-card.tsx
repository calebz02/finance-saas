"use client";

import { Loader2 } from "lucide-react";

import { PlaidConnect } from "@/features/plaid/components/plaid-connect";
import { PlaidDisconnect } from "@/features/plaid/components/plaid-disconnect";
import { useGetConnectedBank } from "@/features/plaid/api/use-get-connected-bank";

import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type Props = {
  plaidEnabled: boolean;
};

export const SettingsCard = ({ plaidEnabled }: Props) => {
  return (
    <Card className="border-none drop-shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl line-clamp-1">
          Settings
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Separator />
        <div className="flex flex-col gap-y-2 lg:flex-row items-center py-4">
          <p className="text-sm font-medium w-full lg:w-[16.5rem]">
            Bank account
          </p>
          {plaidEnabled ? (
            <BankConnection />
          ) : (
            <div className="w-full text-sm text-muted-foreground">
              Automatic bank sync is planned future work. Import transactions from a CSV file instead.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

// Only mounted when Plaid is enabled, so a disabled build never calls the Plaid routes.
const BankConnection = () => {
  const {
    data: connectedBank,
    isLoading,
  } = useGetConnectedBank();

  if (isLoading) {
    return (
      <div className="w-full flex items-center">
        <Loader2 className="size-4 text-slate-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full flex items-center justify-between">
      <div className={cn(
        "text-sm truncate flex items-center",
        !connectedBank && "text-muted-foreground",
      )}>
        {connectedBank
          ? "Bank account connected"
          : "No bank account connected"
        }
      </div>
      {connectedBank
        ? <PlaidDisconnect />
        : <PlaidConnect />
      }
    </div>
  );
};
