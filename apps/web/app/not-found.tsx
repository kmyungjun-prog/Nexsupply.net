import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container" style={{ paddingTop: "4rem", textAlign: "center" }}>
      <h1 className="mb-2">Page not found</h1>
      <p className="text-muted mb-6">The page you requested may have been moved or does not exist.</p>
      <Link href="/" className="btn btn-primary">
        Back to home
      </Link>
    </div>
  );
}
