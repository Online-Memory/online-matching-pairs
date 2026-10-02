import Link from "next/link";

export default function NotFound() {
  return (
    <main className="page page-narrow">
      <h1>Nothing here</h1>
      <p>That page doesn&apos;t exist.</p>
      <Link className="button" href="/">
        Go to the start
      </Link>
    </main>
  );
}
