import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, Clock, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";

interface FinancialSummaryCardsProps {
  totalBilled: number;
  totalReceived: number;
  totalPending: number;
  totalOverdue: number;
  pendingProjectsCount: number;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
};

export function FinancialSummaryCards({
  totalBilled,
  totalReceived,
  totalPending,
  totalOverdue,
  pendingProjectsCount
}: FinancialSummaryCardsProps) {
  const cards = [
    {
      title: "Total Faturado",
      value: formatCurrency(totalBilled),
      icon: DollarSign,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10"
    },
    {
      title: "Total Recebido",
      value: formatCurrency(totalReceived),
      icon: TrendingUp,
      color: "text-green-500",
      bgColor: "bg-green-500/10"
    },
    {
      title: "Em Aberto",
      value: formatCurrency(totalPending),
      subtitle: `${pendingProjectsCount} projeto(s)`,
      icon: Clock,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10"
    },
    {
      title: "Vencido",
      value: formatCurrency(totalOverdue),
      icon: AlertTriangle,
      color: "text-red-500",
      bgColor: "bg-red-500/10"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => (
        <motion.div
          key={card.title}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${card.bgColor}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              {card.subtitle && (
                <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
