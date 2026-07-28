import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle, Megaphone, Users, Zap } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface PromoStatsProps {
  stats: {
    eligibleToday: number;
    sentToday: number;
    purchasedToday: number;
  };
  isLoading: boolean;
}

export function PromoStatsChart({ stats, isLoading }: PromoStatsProps) {
  const conversionRate =
    stats.sentToday > 0
      ? ((stats.purchasedToday / stats.sentToday) * 100).toFixed(1)
      : "0.0";

  return (
    <Card className="border-border/50 bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-pink-500/10 backdrop-blur">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-amber-500" />
          <CardTitle>Performa Promo Spesial (Hari Ini)</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col space-y-2 rounded-lg border border-border/50 bg-background/50 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="h-4 w-4 text-blue-500" />
                  Eligible & Menunggu
                </div>
                <div className="text-3xl font-bold">{stats.eligibleToday.toLocaleString("id-ID")}</div>
              </div>
              <div className="flex flex-col space-y-2 rounded-lg border border-border/50 bg-background/50 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Megaphone className="h-4 w-4 text-amber-500" />
                  Promo Terkirim
                </div>
                <div className="text-3xl font-bold">{stats.sentToday.toLocaleString("id-ID")}</div>
              </div>
              <div className="flex flex-col space-y-2 rounded-lg border border-border/50 bg-background/50 p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  Pembelian Berhasil
                </div>
                <div className="text-3xl font-bold">{stats.purchasedToday.toLocaleString("id-ID")}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">Tingkat Konversi (Conversion Rate)</span>
                <span className="font-bold text-primary">{conversionRate}%</span>
              </div>
              <Progress value={parseFloat(conversionRate)} className="h-3" />
              <p className="text-xs text-muted-foreground">
                Persentase user yang membeli dari total promo yang berhasil dikirimkan hari ini.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
