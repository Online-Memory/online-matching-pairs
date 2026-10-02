import type { Metadata } from "next";

import { TableScreen } from "@/components/TableScreen";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `Table ${code.toUpperCase()} · Matching Pairs` };
}

export default async function TablePage({ params }: Props) {
  const { code } = await params;
  return <TableScreen code={code.toUpperCase()} />;
}
