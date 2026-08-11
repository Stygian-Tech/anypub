import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnvironmentBanner } from "@/components/environment-banner";

describe("EnvironmentBanner", () => {
  it.each(["local", "dev"] as const)("shows the %s environment", (appEnv) => {
    render(<EnvironmentBanner appEnv={appEnv} />);
    expect(screen.getByRole("status", { name: `${appEnv} environment` })).toHaveTextContent(appEnv);
  });

  it("is absent in production", () => {
    const { container } = render(<EnvironmentBanner appEnv="prod" />);
    expect(container).toBeEmptyDOMElement();
  });
});
