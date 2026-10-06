import type { Metadata } from "next";

import { TableScreen } from "@/components/TableScreen";

type Props = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `Table ${code.toUpperCase()} · Matching Pairs` };
}

export default async function TablePage({ params, searchParams }: Props) {
  const { code } = await params;
  const { join } = await searchParams;
  return <TableScreen code={code.toUpperCase()} autoJoin={join === "1"} />;
}
