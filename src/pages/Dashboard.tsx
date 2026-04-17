import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserPlus,
  Activity,
  UserMinus,
  AlertTriangle,
  RefreshCw,
  Moon,
  Sun,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useEffect } from "react";

// Helper: WIB timezone-aware day boundaries
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function startOfTodayWIB(): Date {
  const now = new Date();
  const wibNow = new Date(now.getTime() + WIB_OFFSET_MS);
  wibNow.setUTCHours(0, 0, 0, 0);
  return new Date(wibNow.getTime() - WIB_OFFSET_MS);
}

function daysAgoWIB(days: number): Date {
  const start = startOfTodayWIB();
  return new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
}

const formatDateID = (date: Date) =>
  date.toLocaleDateString("id-ID", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const fetchKPIs = async () => {
  const todayStart = startOfTodayWIB().toISOString();
  const day30 = daysAgoWIB(30).toISOString();
  const day31 = daysAgoWIB(31).toISOString();

  const [newToday, activeToday, inactive30, churn] = await Promise.all([
    supabase
      .from("telegram_users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart),
    supabase
      .from("telegram_users")
      .select("id", { count: "exact", head: true })
      .gte("last_active", todayStart),
    supabase
      .from("telegram_users")
      .select("id", { count: "exact", head: true })
      .lt("last_active", day30),
    supabase
      .from("telegram_users")
      .select("id", { count: "exact", head: true })
      .gte("last_active", day31)
      .lt("last_active", day30),
  ]);

  const errs = [newToday, activeToday, inactive30, churn].find((r) => r.error);
  if (errs?.error) throw errs.error;

  return {
    newToday: newToday.count ?? 0,
    activeToday: activeToday.count ?? 0,
    inactive30: inactive30.count ?? 0,
    churn: churn.count ?? 0,
  };
};

const fetch7DayActivity = async () => {
  const start = daysAgoWIB(6).toISOString();
  const [created, active] = await Promise.all([
    supabase
      .from("telegram_users")
      .select("created_at")
      .gte("created_at", start),
    supabase
      .from("telegram_users")
      .select("last_active")
      .gte("last_active", start),
  ]);
  if (created.error) throw created.error;
  if (active.error) throw active.error;

  const days: { date: Date; key: string; label: string; baru: number; aktif: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = daysAgoWIB(i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: d, key, label: formatDateID(d), baru: 0, aktif: 0 });
  }
  const bucket = (iso: string) => {
    const d = new Date(iso);
    const wib = new Date(d.getTime() + WIB_OFFSET_MS);
    return wib.toISOString().slice(0, 10);
  };
  for (const row of created.data ?? []) {
    const k = bucket(row.created_at as string);
    const day = days.find((x) => x.key === k);
    if (day) day.baru++;
  }
  for (const row of active.data ?? []) {
    const k = bucket(row.last_active as string);
    const day = days.find((x) => x.key === k);
    if (day) day.aktif++;
  }
  return days.map(({ label, baru, aktif }) => ({ label, baru, aktif }));
};

const KPICard = ({
  title,
  value,
  Icon,
  loading,
  accent,
}: {
  title: string;
  value: number;
  Icon: typeof UserPlus;
  loading: boolean;
  accent: string;
}) => (
  <Card className="overflow-hidden border-border/50 bg-card/60 backdrop-blur transition hover:border-primary/40 hover:shadow-lg">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      <div className={`rounded-md p-2 ${accent}`}>
        <Icon className="h-4 w-4 text-primary-foreground" />
      </div>
    </CardHeader>
    <CardContent>
      {loading ? (
        <Skeleton className="h-9 w-20" />
      ) : (
        <div className="text-3xl font-bold tracking-tight">{value.toLocaleString("id-ID")}</div>
      )}
    </CardContent>
  </Card>
);

const Dashboard = () => {
  const { theme, setTheme } = useTheme();

  const kpiQ = useQuery({ queryKey: ["kpis"], queryFn: fetchKPIs });
  const chartQ = useQuery({ queryKey: ["activity-7d"], queryFn: fetch7DayActivity });

  useEffect(() => {
    if (kpiQ.error || chartQ.error) {
      toast.error("Gagal mengambil data dari database");
    }
  }, [kpiQ.error, chartQ.error]);

  const handleRefresh = () => {
    kpiQ.refetch();
    chartQ.refetch();
    toast.success("Data sedang disegarkan");
  };

  const isLoading = kpiQ.isLoading || chartQ.isLoading;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <header className="sticky top-0 z-10 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="container flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard Admin FizaTalk</h1>
            <p className="text-sm text-muted-foreground">Pantau performa & aktivitas pengguna bot</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label="Ganti tema"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
              Segarkan Data
            </Button>
          </div>
        </div>
      </header>

      <main className="container space-y-6 py-6">
        {isLoading && (
          <p className="text-sm text-muted-foreground">Memuat data...</p>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard
            title="Pengguna Baru (Hari Ini)"
            value={kpiQ.data?.newToday ?? 0}
            Icon={UserPlus}
            loading={kpiQ.isLoading}
            accent="bg-primary"
          />
          <KPICard
            title="Pengguna Aktif (Hari Ini)"
            value={kpiQ.data?.activeToday ?? 0}
            Icon={Activity}
            loading={kpiQ.isLoading}
            accent="bg-accent"
          />
          <KPICard
            title="Tidak Aktif (>30 Hari)"
            value={kpiQ.data?.inactive30 ?? 0}
            Icon={UserMinus}
            loading={kpiQ.isLoading}
            accent="bg-muted-foreground/60"
          />
          <KPICard
            title="User Churn (Tepat 30 Hari)"
            value={kpiQ.data?.churn ?? 0}
            Icon={AlertTriangle}
            loading={kpiQ.isLoading}
            accent="bg-destructive"
          />
        </section>

        <Card className="border-border/50 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle>Statistik Aktivitas (7 Hari Terakhir)</CardTitle>
          </CardHeader>
          <CardContent>
            {chartQ.isLoading ? (
              <Skeleton className="h-[320px] w-full" />
            ) : (
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartQ.data ?? []} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.5rem",
                        color: "hsl(var(--popover-foreground))",
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Line
                      type="monotone"
                      dataKey="baru"
                      name="Pengguna Baru"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="aktif"
                      name="Pengguna Aktif"
                      stroke="hsl(var(--accent))"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Dashboard;
