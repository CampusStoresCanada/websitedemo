import { formatMonthDay } from "@/lib/policy/format";

interface Props {
  cycleStartMonthDay: string;
}

export default function RenewalTerms({ cycleStartMonthDay }: Props) {
  return (
    <p className="mt-4 text-center text-xs text-[#6B6B6B]">
      Dues renew annually on {formatMonthDay(cycleStartMonthDay)}.
    </p>
  );
}
