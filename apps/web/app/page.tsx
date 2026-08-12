import Link from "next/link";
import { ArrowRightIcon, CalendarClockIcon, ImageIcon, SendIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            AnyPub <Badge variant="accent" className="uppercase tracking-wide">Alpha</Badge>
          </Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/editor">Open editor <ArrowRightIcon data-icon="inline-end" /></Link>
          </Button>
        </div>
      </header>

      <section className="relative flex flex-1 items-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(79,125,167,0.15),transparent_38%)]" />
        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-center">
          <div className="space-y-7">
            <div className="text-sm font-medium text-[#4f7da7]">One editor. Your publications.</div>
            <div className="space-y-5">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
                Publish to the open social web without rebuilding your workflow.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                AnyPub is a standard.site CMS for writing, scheduling, and publishing rich articles from your AT Protocol account.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/login">Continue with AT Protocol <ArrowRightIcon data-icon="inline-end" /></Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <a href="https://standard.site" target="_blank" rel="noreferrer">Learn about standard.site</a>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border bg-card/80 p-4 shadow-sm backdrop-blur sm:p-5">
            <HomeFeature icon={SendIcon} title="Publish anywhere" description="Write once and target compatible AT Protocol publications." />
            <HomeFeature icon={ImageIcon} title="Rich media" description="Add image previews, body media, tags, and platform-native content." />
            <HomeFeature icon={CalendarClockIcon} title="Plan ahead" description="Keep drafts organized and experiment with scheduled publishing." />
          </div>
        </div>
      </section>
    </main>
  );
}

function HomeFeature({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof SendIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-4 rounded-xl border bg-background/80 p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#4f7da7]/12 text-[#4f7da7]">
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="font-medium">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
