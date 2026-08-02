import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-brand">
          <div className="sidebar-logo-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <h1>PG Vitals</h1>
          <p>PostgreSQL Monitoring & Diagnostics</p>
        </div>
        <SignIn />
      </div>
    </div>
  );
}
