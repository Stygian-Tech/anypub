type Environment = Record<string, string | undefined>;
type HeaderReader = Pick<Headers, "get">;

const localWebURL = new URL("http://localhost:3000");

export function getWebPublicURL(
  environment: Environment = process.env,
  requestHeaders?: HeaderReader,
): URL {
  const railwayDomain = environment.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) {
    const railwayURL = parseOrigin(
      railwayDomain.includes("://") ? railwayDomain : `https://${railwayDomain}`,
    );
    if (railwayURL) return railwayURL;
  }

  const configuredURL = parseOrigin(environment.WEB_PUBLIC_URL?.trim());
  if (configuredURL) return configuredURL;

  const forwardedHost = firstHeaderValue(requestHeaders?.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(requestHeaders?.get("host"));
  if (!host) return localWebURL;

  const forwardedProtocol = firstHeaderValue(requestHeaders?.get("x-forwarded-proto"));
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https";

  return parseOrigin(`${protocol}://${host}`) ?? localWebURL;
}

function firstHeaderValue(value: string | null | undefined): string {
  return value?.split(",", 1)[0]?.trim() ?? "";
}

function parseOrigin(value: string | undefined): URL | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}
