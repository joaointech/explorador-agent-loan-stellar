"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, LayoutDashboard, ListChecks, Users, Wrench } from "lucide-react";
import type { AdminAgentsResponse, AdminCpcvListResponse, AdminOverviewResponse } from "@/lib/api-types";
import { ErrorNote, Eyebrow } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe, usePoll } from "@/lib/client/hooks";
import { AgentsTable } from "./agents-table";
import { CpcvTable } from "./cpcv-table";
import { Dashboard } from "./dashboard";
import { DemoPanel } from "./demo-panel";
import { NewCpcvForm } from "./new-cpcv";

const TABS = ["dashboard", "new", "cpcvs", "agents", "demo"] as const;
export type AdminTab = (typeof TABS)[number];

export function AdminApp() {
  const router = useRouter();
  const me = useMe();
  const user = me.data?.user ?? null;
  const isAdmin = user?.role === "ADMIN";

  React.useEffect(() => {
    if (!me.loading && me.data && !user) router.replace("/login?next=/admin");
  }, [me.loading, me.data, user, router]);

  if (me.loading || (me.data && !user)) {
    return (
      <Shell>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-6 h-96 rounded-3xl" />
      </Shell>
    );
  }
  if (me.error && !me.data) {
    return (
      <Shell>
        <ErrorNote>Could not check your session: {me.error.message}</ErrorNote>
      </Shell>
    );
  }
  if (!isAdmin) {
    return (
      <Shell>
        <ErrorNote>The admin panel is for explorador staff. You are signed in as an agent.</ErrorNote>
        <Button asChild className="mt-4">
          <Link href="/agent">Go to your agent app →</Link>
        </Button>
      </Shell>
    );
  }
  return <AdminPanel />;
}

function AdminPanel() {
  const [tab, setTab] = React.useState<AdminTab>("dashboard");
  const overview = usePoll<AdminOverviewResponse>("/api/admin/overview", 10_000);
  const agents = usePoll<AdminAgentsResponse>("/api/admin/agents", 15_000);
  const cpcvs = usePoll<AdminCpcvListResponse>("/api/admin/cpcv", 15_000);

  React.useEffect(() => {
    const fromHash = window.location.hash.slice(1) as AdminTab;
    if (TABS.includes(fromHash)) setTab(fromHash);
    // §9.5: the retry sweep for failed/stuck card draws also runs on admin page load.
    fetch("/api/cron/retry-draws", { credentials: "same-origin" }).catch(() => undefined);
  }, []);

  const go = React.useCallback((t: AdminTab) => {
    setTab(t);
    window.history.replaceState(null, "", `#${t}`);
  }, []);

  const { refresh: refreshOverview } = overview;
  const { refresh: refreshAgents } = agents;
  const { refresh: refreshCpcvs } = cpcvs;
  const refreshAll = React.useCallback(() => {
    void refreshOverview();
    void refreshAgents();
    void refreshCpcvs();
  }, [refreshOverview, refreshAgents, refreshCpcvs]);

  const pool = overview.data?.pool ?? null;

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>explorador · admin</Eyebrow>
          <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight sm:text-[34px]">
            Run the <span className="text-primary">pool.</span>
          </h1>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => go(v as AdminTab)} className="mt-6">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="dashboard">
            <LayoutDashboard /> Dashboard
          </TabsTrigger>
          <TabsTrigger value="new">
            <FilePlus2 /> New CPCV
          </TabsTrigger>
          <TabsTrigger value="cpcvs">
            <ListChecks /> CPCVs
          </TabsTrigger>
          <TabsTrigger value="agents">
            <Users /> Agents
          </TabsTrigger>
          <TabsTrigger value="demo">
            <Wrench /> Demo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <Dashboard overview={overview} onChanged={refreshAll} onGo={go} />
        </TabsContent>
        <TabsContent value="new" className="mt-6">
          <NewCpcvForm agents={agents.data?.agents ?? null} pool={pool} onCreated={refreshAll} />
        </TabsContent>
        <TabsContent value="cpcvs" className="mt-6">
          <CpcvTable state={cpcvs} today={pool ? Math.floor(pool.demo.protocolNow / 86_400) : null} onChanged={refreshAll} onNew={() => go("new")} />
        </TabsContent>
        <TabsContent value="agents" className="mt-6">
          <AgentsTable state={agents} protocolNow={pool?.demo.protocolNow ?? null} onChanged={refreshAll} />
        </TabsContent>
        <TabsContent value="demo" className="mt-6">
          <DemoPanel overview={overview.data} agents={agents.data?.agents ?? null} onChanged={refreshAll} />
        </TabsContent>
      </Tabs>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:py-8">{children}</div>;
}
