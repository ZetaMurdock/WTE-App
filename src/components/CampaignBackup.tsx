import { useState } from "react";
import type { Campaign } from "../models/campaign";
import { pushToast } from "../lib/appToast";
import {
  buildPackage,
  importPackage,
  packageFilename,
  parsePackage,
  planImport,
  serializePackage,
} from "../lib/campaignPackage";
import { getVersion } from "../lib/tauri";
import { collectCampaignPages } from "../lib/campaignPages";

interface Props {
  campaign: Campaign;
  onImported: () => void;
}

interface TauriApi {
  core: { invoke: <R>(cmd: string, args?: Record<string, unknown>) => Promise<R> };
  dialog?: {
    open?: (o: Record<string, unknown>) => Promise<string | string[] | null>;
  };
}
function tauri(): TauriApi | null {
  return (window as unknown as { __TAURI__?: TauriApi }).__TAURI__ ?? null;
}

// Whole-campaign export and import. Before this the only export in the app was one
// character at a time, so moving a campaign to another machine meant copying
// wte.db by hand — and it arrived without anything that lived in localStorage.
export function CampaignBackup({ campaign, onImported }: Props) {
  const [busy, setBusy] = useState<"" | "export" | "import">("");

  async function doExport() {
    const t = tauri();
    if (!t?.core) {
      pushToast("Exporting a campaign needs the desktop app.", "error");
      return;
    }
    setBusy("export");
    try {
      const appVersion = await getVersion().catch(() => undefined);
      // The campaign's own Codex pages travel with it. Without them a package
      // restores the characters and the scenes and then plays by the OFFICIAL
      // rules, because the table's house rules were never in the file.
      const page = await collectCampaignPages(campaign.id);
      const pkg = await buildPackage(campaign, { appVersion: appVersion ?? undefined, pages: page.pages });
      // RUST OWNS THE SAVE DIALOG. We pass content and a suggested FILENAME, never a
      // path — so the webview cannot name a destination at all, and what gets
      // written is by construction what the user confirmed in a native dialog.
      const written = await t.core.invoke<string | null>("wte_export_campaign", {
        content: serializePackage(pkg),
        defaultName: packageFilename(campaign),
      });
      if (!written) return; // cancelled
      const n = pkg.characters.length + pkg.scenes.length + pkg.notes.length + pkg.sequences.length;
      pushToast(
        `Exported "${campaign.name}" — ${n} records, ${page.pages.length} Codex page${page.pages.length === 1 ? "" : "s"}, settings and folder trees.`,
        "info",
        9000
      );
      // Say what did NOT travel. A package quietly missing a house rule is the
      // exact failure this is meant to prevent.
      if (page.unreadable.length) {
        pushToast(`${page.unreadable.length} Codex page(s) could not be read and are NOT in this package.`, "error", 0);
      }
      if (page.unowned.length) {
        pushToast(
          `${page.unowned.length} page(s) change official rules but do not record which campaign owns them, so they were not included: ${page.unowned.slice(0, 3).join(", ")}. Re-save them from the Codex to pin their owner.`,
          "info",
          0
        );
      }
    } catch (e) {
      pushToast(`Couldn't export the campaign: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy("");
    }
  }

  async function doImport() {
    const t = tauri();
    if (!t?.dialog?.open) {
      pushToast("Importing a campaign needs the desktop app.", "error");
      return;
    }
    setBusy("import");
    try {
      const picked = await t.dialog.open({
        title: "Import campaign",
        multiple: false,
        filters: [{ name: "W.T.E campaign", extensions: ["wtepack", "json"] }],
      });
      const path = Array.isArray(picked) ? picked[0] : picked;
      if (!path) return;

      // wte_read_package, NOT wte_load_page: that command resolves a Codex page
      // STEM inside the rules folders, so handing it an absolute .wtepack path
      // made it search for a rules page named after the whole path. It never
      // found one, and every import failed with "Couldn't read that file"
      // however good the package was.
      const text = await t.core.invoke<string>("wte_read_package", { path }).catch((e) => {
        pushToast(e instanceof Error ? e.message : String(e), "error");
        return null;
      });
      if (text === null) {
        pushToast("Couldn't read that file.", "error");
        return;
      }
      // parsePackage throws on a newer format or a file that is not a package —
      // both are better than importing something we do not fully understand.
      const pkg = parsePackage(JSON.parse(text));
      const plan = await planImport(pkg);

      // An id collision is the case that needs a decision, so ask rather than
      // picking a default that could replace records the user still has.
      let mode: "copy" | "merge" = "copy";
      if (plan.collision) {
        mode = confirm(
          `A campaign with this id already exists.\n\n` +
            `OK — MERGE: update the existing campaign in place. Records with matching ids are replaced.\n` +
            `Cancel — COPY: import alongside it as a separate campaign, changing nothing you already have.`
        )
          ? "merge"
          : "copy";
      }

      const r = await importPackage(pkg, mode);
      const done = Object.values(r.imported).reduce((a, b) => a + b, 0);
      if (r.failed.length) {
        pushToast(
          `Imported ${done} records, but ${r.failed.length} failed: ${r.failed
            .slice(0, 3)
            .map((f) => f.what)
            .join(", ")}`,
          "error",
          14000
        );
      } else {
        pushToast(`Imported "${pkg.campaign.name}" — ${done} records.`, "info", 9000);
      }
      onImported();
    } catch (e) {
      pushToast(`Couldn't import: ${e instanceof Error ? e.message : String(e)}`, "error", 14000);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="backup-row">
      <button className="ghost-btn" onClick={doExport} disabled={busy !== ""}>
        {busy === "export" ? "Exporting…" : "Export campaign"}
      </button>
      <button className="ghost-btn" onClick={doImport} disabled={busy !== ""}>
        {busy === "import" ? "Importing…" : "Import campaign"}
      </button>
      <span className="backup-hint">
        A package carries the campaign, its characters, scenes, encounters, assets, notes, Sequences and settings.
      </span>
    </div>
  );
}
