import { useCallback, useEffect, useState } from "react";
import { probeMigrationGate, type MigrationGate } from "../lib/db";
import { DataBlocked } from "./DataBlocked";

interface Props {
  children: React.ReactNode;
}

// Decides whether the app is allowed to touch the database at all.
//
// getDb() already refuses when the pre-upgrade backup failed, but roughly two
// dozen call sites turn a rejection into an empty list — so on its own that
// refusal would render as "you have no campaigns, characters or scenes", which is
// a far more alarming lie than the truth. This asks once, up front, and puts the
// real reason on screen instead of mounting an app that cannot work.
export function BootGate({ children }: Props) {
  const [gate, setGate] = useState<MigrationGate | null>(null);
  const [checked, setChecked] = useState(false);

  const check = useCallback(() => {
    let live = true;
    setChecked(false);
    probeMigrationGate().then((g) => {
      if (!live) return;
      setGate(g && !g.ok ? g : null);
      setChecked(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(check, [check]);

  // Deliberately renders nothing rather than a spinner: the answer is one IPC
  // call away, and a "Loading..." that can outlive its cause is the failure mode
  // this build exists to remove.
  if (!checked) return null;
  if (gate) return <DataBlocked gate={gate} onRetry={check} />;
  return <>{children}</>;
}
