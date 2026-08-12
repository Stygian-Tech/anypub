import * as React from "react";
import { Highlight, Prism, type PrismTheme } from "prism-react-renderer";

const unstyledTheme: PrismTheme = { plain: {}, styles: [] };

const languageAliases: Record<string, string> = {
  cxx: "cpp",
  "c++": "cpp",
  html: "markup",
  js: "javascript",
  jsonc: "json",
  kt: "kotlin",
  md: "markdown",
  objc: "objectivec",
  "objective-c": "objectivec",
  py: "python",
  rs: "rust",
  ts: "typescript",
  yml: "yaml",
};

export function SyntaxHighlightedCode({ code, language }: { code: string; language?: string }) {
  const prismLanguage = supportedLanguage(language);

  return (
    <Highlight code={code} language={prismLanguage} theme={unstyledTheme}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre
          data-testid="syntax-highlighted-code"
          data-language={language || undefined}
          data-highlight-language={prismLanguage}
          className="bg-muted overflow-auto rounded-md p-3 text-base leading-7"
        >
          <code className={`language-${prismLanguage}`}>
            {tokens.map((line, lineIndex) => (
              <React.Fragment key={lineIndex}>
                <span {...getLineProps({ line })}>
                  {line.map((token, tokenIndex) => {
                    const tokenProps = getTokenProps({ token });
                    return (
                      <span key={tokenIndex} {...tokenProps}>
                        {token.empty ? "" : tokenProps.children}
                      </span>
                    );
                  })}
                </span>
                {lineIndex < tokens.length - 1 ? "\n" : null}
              </React.Fragment>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}

function supportedLanguage(language?: string) {
  const normalized = language?.trim().toLowerCase() ?? "";
  const candidate = languageAliases[normalized] ?? normalized;
  return candidate && Prism.languages[candidate] ? candidate : "plaintext";
}
