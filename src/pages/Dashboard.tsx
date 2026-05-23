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
  Smile,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useEffect } from "react";

const fetchStats = async () => {
  const { data, error } = await supabase.functions.invoke("admin-stats");
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as {
    kpis: { newToday: number; activeToday: number; inactive30: number; churn: number; reengageReturns: number };
    activity: { label: string; baru: number; aktif: number; churn: number; baru30hariLalu: number }[];
    reengageActivity: {
      label: string;
      cute_pleading_cat: number;
      mysterious_gift_box: number;
      grumpy_cute_cat: number;
      social_match_hearts: number;
      total: number;
    }[];
  };
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

  const statsQ = useQuery({ queryKey: ["admin-stats"], queryFn: fetchStats });
  const kpis = statsQ.data?.kpis;
  const activity = statsQ.data?.activity ?? [];
  const reengageActivity = statsQ.data?.reengageActivity ?? [];

  useEffect(() => {
    if (statsQ.error) {
      toast.error("Gagal mengambil data dari database");
    }
  }, [statsQ.error]);

  const handleRefresh = () => {
    statsQ.refetch();
    toast.success("Data sedang disegarkan");
  };

  const isLoading = statsQ.isLoading;

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

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KPICard
            title="Pengguna Baru (Hari Ini)"
            value={kpis?.newToday ?? 0}
            Icon={UserPlus}
            loading={isLoading}
            accent="bg-primary"
          />
          <KPICard
            title="Pengguna Aktif (Hari Ini)"
            value={kpis?.activeToday ?? 0}
            Icon={Activity}
            loading={isLoading}
            accent="bg-accent"
          />
          <KPICard
            title="Tidak Aktif (>30 Hari)"
            value={kpis?.inactive30 ?? 0}
            Icon={UserMinus}
            loading={isLoading}
            accent="bg-muted-foreground/60"
          />
          <KPICard
            title="User Churn (Tepat 30 Hari)"
            value={kpis?.churn ?? 0}
            Icon={AlertTriangle}
            loading={isLoading}
            accent="bg-destructive"
          />
          <KPICard
            title="User Kembali (30 Hari)"
            value={kpis?.reengageReturns ?? 0}
            Icon={Smile}
            loading={isLoading}
            accent="bg-emerald-500"
          />
        </section>

        <Card className="border-border/50 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle>Statistik Aktivitas (30 Hari Terakhir)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[320px] w-full" />
            ) : (
              <div className="h-[320px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activity} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      allowDecimals={false}
                      domain={['auto', 'auto']}
                      allowDataOverflow={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.5rem",
                        color: "hsl(var(--popover-foreground))",
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                      formatter={(value: number, name: string) => [value.toLocaleString("id-ID"), name]}
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
                    <Line
                      type="monotone"
                      dataKey="churn"
                      name="User Churn"
                      stroke="hsl(var(--destructive))"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="baru30hariLalu"
                      name="Pengguna Baru 30 Hari Lalu"
                      stroke="hsl(32 95% 55%)"
                      strokeWidth={2.5}
                      strokeDasharray="5 5"
                      dot={{ r: 3 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle>Total User Kembali per Hari &amp; Breakdown Konversi (30 Hari Terakhir)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[360px] w-full" />
            ) : (
              <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={reengageActivity} margin={{ top: 20, right: 16, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      allowDecimals={false}
                      domain={['auto', 'auto']}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.5rem",
                        color: "hsl(var(--popover-foreground))",
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
                      formatter={(value: number, name: string) => [value.toLocaleString("id-ID"), name]}
                    />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Bar
                      dataKey="cute_pleading_cat"
                      name="Manja/Romantis (Cute Cat)"
                      stackId="a"
                      fill="#ec4899"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="mysterious_gift_box"
                      name="Misterius/Kado (Gift Box)"
                      stackId="a"
                      fill="#8b5cf6"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="grumpy_cute_cat"
                      name="Ngambek/Perhatian (Grumpy Cat)"
                      stackId="a"
                      fill="#f59e0b"
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey="social_match_hearts"
                      name="Sosial/Match (Hearts)"
                      stackId="a"
                      fill="#10b981"
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="total"
                      name="Total User Kembali"
                      stroke="#06b6d4"
                      strokeWidth={3}
                      dot={{ r: 4, fill: "#06b6d4", stroke: "#fff", strokeWidth: 2 }}
                      activeDot={{ r: 7, fill: "#06b6d4", stroke: "#fff", strokeWidth: 2 }}
                    />
                  </ComposedChart>
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
