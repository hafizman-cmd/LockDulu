import { SearchX } from "lucide-react";
import Link from "next/link";
export default function NotFound() {
  return <main className="wrap centered"><div className="empty surface"><SearchX strokeWidth={1.5} />
    <h1>Page unavailable</h1><p>This store or garment could not be found.</p><Link className="button primary" href="/">Browse shops</Link>
  </div></main>;
}
