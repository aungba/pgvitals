import { SignUp } from "@clerk/nextjs";
import { LogoIcon } from "../../components/Logo";

export default function SignUpPage() {
  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-brand">
          <LogoIcon size={44} />
          <h1>PG Vitals</h1>
          <p>PostgreSQL Monitoring & Diagnostics</p>
        </div>
        <SignUp />
      </div>
    </div>
  );
}
