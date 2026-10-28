// @vitest-environment jsdom
//
// PA-287: SSHAccessDoc is a static documentation panel covering SSH/browser
// terminal access. These tests pin the title, the connection methods, the
// keygen snippets, the SSH config example, the file-transfer commands, and the
// security best-practices section.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { SSHAccessDoc } from "@/app/dashboard/components/docs/SSHAccessDoc";

describe("SSHAccessDoc", () => {
  it("renders the lead and leaves the page title to DocPage", () => {
    render(<SSHAccessDoc />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(
      screen.getByText(/connect securely to your gpu instances/i),
    ).toBeInTheDocument();
  });

  it("documents both connection methods", () => {
    render(<SSHAccessDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /browser terminal/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: /^ssh access$/i }),
    ).toBeInTheDocument();
  });

  it("shows the ed25519 keygen snippet", () => {
    render(<SSHAccessDoc />);
    expect(
      screen.getByText(/ssh-keygen -t ed25519 -C "your_email@example\.com"/),
    ).toBeInTheDocument();
  });

  it("documents the 10-key-per-account limit", () => {
    render(<SSHAccessDoc />);
    expect(screen.getByText(/up to/i)).toBeInTheDocument();
    expect(screen.getByText(/10 SSH keys/i)).toBeInTheDocument();
  });

  it("provides an ~/.ssh/config example", () => {
    render(<SSHAccessDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /ssh config \(recommended\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Host my-gpu/)).toBeInTheDocument();
  });

  it("documents file transfer via scp and rsync", () => {
    render(<SSHAccessDoc />);
    expect(
      screen.getByRole("heading", { level: 3, name: /using scp/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/scp -P 30123 local_file\.txt/),
    ).toBeInTheDocument();
  });

  it("documents VS Code Remote SSH setup", () => {
    render(<SSHAccessDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /vs code remote ssh/i }),
    ).toBeInTheDocument();
  });

  it("lists security best practices favouring ED25519 keys", () => {
    render(<SSHAccessDoc />);
    expect(
      screen.getByRole("heading", { level: 2, name: /security best practices/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/use ed25519 keys/i)).toBeInTheDocument();
  });
});
