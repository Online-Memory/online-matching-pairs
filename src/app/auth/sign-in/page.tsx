import { SignInForm } from "@/components/SignInForm";

export const metadata = { title: "Sign in · Matching Pairs" };

export default function SignInPage() {
  return (
    <main className="page page-narrow">
      <SignInForm />
    </main>
  );
}
