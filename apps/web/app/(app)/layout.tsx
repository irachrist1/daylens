import { AppChrome } from "@/app/components/AppChrome";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppChrome>{children}</AppChrome>;
}
