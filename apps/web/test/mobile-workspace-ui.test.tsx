import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileWorkspaceFooter } from "@/components/cms/mobile-workspace-footer";
import { WorkspaceHeader } from "@/components/cms/workspace-header";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { LinkedAccount, Publication } from "@/lib/types";

const account: LinkedAccount = {
  id: "account-1",
  did: "did:plc:writer",
  handle: "writer.example",
  displayName: "Writer",
  pdsURL: "https://pds.example",
  scope: "atproto",
  linkedAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
};

const publication: Publication = {
  id: "publication-1",
  accountDID: account.did,
  uri: `at://${account.did}/site.standard.publication/blog`,
  name: "Writer Blog",
  url: "https://writer.example",
  syncedAt: "2026-08-11T00:00:00.000Z",
};

function renderHeader(overrides: Partial<React.ComponentProps<typeof WorkspaceHeader>> = {}) {
  const props: React.ComponentProps<typeof WorkspaceHeader> = {
    activeView: "posts",
    mobilePane: "write",
    activeDraftTitle: "Touch-first post",
    account,
    theme: "light",
    fontPreference: "sans",
    boldText: false,
    smallText: false,
    publications: [publication],
    isSyncing: false,
    isPublishing: false,
    isUpdating: false,
    isLoggingOut: false,
    canPublish: true,
    onThemeChange: vi.fn(),
    onFontPreferenceChange: vi.fn(),
    onBoldTextChange: vi.fn(),
    onSmallTextChange: vi.fn(),
    onSync: vi.fn(),
    onCreateDraft: vi.fn(async () => true),
    onPublish: vi.fn(),
    onLogOut: vi.fn(),
    onViewChange: vi.fn(),
    onMobilePaneChange: vi.fn(),
    onBackToPosts: vi.fn(),
    ...overrides,
  };

  render(<TooltipProvider><WorkspaceHeader {...props} /></TooltipProvider>);
  return props;
}

describe("mobile workspace controls", () => {
  it("provides explicit back and editor-pane navigation", () => {
    const props = renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Back to posts" }));
    fireEvent.click(screen.getByRole("button", { name: "details" }));

    expect(props.onBackToPosts).toHaveBeenCalledOnce();
    expect(props.onMobilePaneChange).toHaveBeenCalledWith("details");
  });

  it("keeps appearance, sync, and logout discoverable in the account sheet", async () => {
    const props = renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Account and appearance" }));

    expect(await screen.findByText("Account & appearance")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Sync publications" }));
    fireEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(props.onThemeChange).toHaveBeenCalledWith("dark");
    expect(props.onSync).toHaveBeenCalledOnce();
    expect(props.onLogOut).toHaveBeenCalledOnce();
  });

  it("exposes global destinations below xl when no post is open", () => {
    const onViewChange = vi.fn();
    render(
      <MobileWorkspaceFooter
        activeView="posts"
        editing={false}
        saveState="saved"
        canPublish={false}
        isPublishing={false}
        isUpdating={false}
        onViewChange={onViewChange}
        onSave={() => undefined}
        onPublish={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Feedback" }));
    expect(onViewChange).toHaveBeenCalledWith("feedback");
  });

  it("keeps save and publish actions in the editing footer", () => {
    const onSave = vi.fn();
    const onPublish = vi.fn();
    render(
      <MobileWorkspaceFooter
        activeView="posts"
        editing
        saveState="unsaved"
        canPublish
        isPublishing={false}
        isUpdating={false}
        onViewChange={() => undefined}
        onSave={onSave}
        onPublish={onPublish}
      />,
    );

    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onPublish).toHaveBeenCalledOnce();
  });
});
