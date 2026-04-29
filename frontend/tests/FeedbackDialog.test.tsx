import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, type Mock } from "vitest";

import * as useApiModule from "../src/api/use-api";
import type { ApiClient, FeedbackPayload } from "../src/api/client";
import FeedbackDialog from "../src/components/FeedbackDialog";
import { makeFakeAuth, makeFakeUser, renderWithAuth } from "./test-utils";

interface FakeApi extends ApiClient {
  submitFeedback: Mock;
}

function makeFakeApi(): FakeApi {
  const api: Partial<ApiClient> & { submitFeedback: Mock } = {
    submitFeedback: vi.fn().mockResolvedValue({ id: "fb-1" }),
  };
  return api as FakeApi;
}

function render(api: FakeApi, open = true) {
  vi.spyOn(useApiModule, "useApi").mockReturnValue(api);
  return renderWithAuth(
    <FeedbackDialog open={open} onClose={vi.fn()} />,
    {
      auth: makeFakeAuth({ isAuthenticated: true, user: makeFakeUser() }),
      wrapper: (c) => <MemoryRouter initialEntries={["/editor"]}>{c}</MemoryRouter>,
    },
  );
}

describe("FeedbackDialog", () => {
  it("rendert nichts bei open=false", () => {
    const api = makeFakeApi();
    render(api, false);
    expect(screen.queryByTestId("feedback-dialog")).toBeNull();
  });

  it("submitten erfordert mindestens 10 Zeichen", async () => {
    const api = makeFakeApi();
    render(api);
    const submit = screen.getByTestId("feedback-submit");
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByTestId("feedback-message"), "kurz");
    expect(submit).toBeDisabled();
    expect(api.submitFeedback).not.toHaveBeenCalled();
  });

  it("ruft submitFeedback mit kind, message, page und Honeypot=leer auf", async () => {
    const api = makeFakeApi();
    render(api);

    await userEvent.click(screen.getByTestId("feedback-kind-idea"));
    await userEvent.type(
      screen.getByTestId("feedback-message"),
      "Tooltip auf den Slidern wuerde sehr helfen.",
    );
    await userEvent.click(screen.getByTestId("feedback-submit"));

    await waitFor(() => {
      expect(api.submitFeedback).toHaveBeenCalledTimes(1);
    });
    const arg = api.submitFeedback.mock.calls[0]![0] as FeedbackPayload;
    expect(arg.kind).toBe("idea");
    expect(arg.message).toContain("Tooltip");
    expect(arg.page).toBe("/editor");
    expect(arg.website).toBe("");
  });

  it("Honeypot-Feld ist visuell und a11y versteckt", () => {
    const api = makeFakeApi();
    render(api);
    const honeypot = screen.getByTestId("feedback-honeypot");
    // Wrapper muss aria-hidden sein, Input out-of-flow
    const wrapper = honeypot.closest("[aria-hidden='true']");
    expect(wrapper).not.toBeNull();
    expect(honeypot.getAttribute("tabindex")).toBe("-1");
    expect(honeypot.getAttribute("autocomplete")).toBe("off");
  });

  it("zeigt Status-Feedback nach erfolgreichem Submit", async () => {
    const api = makeFakeApi();
    render(api);
    await userEvent.type(
      screen.getByTestId("feedback-message"),
      "Ein passendes Feedback mit ausreichend Zeichen.",
    );
    await userEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("feedback-status").textContent).toMatch(
        /Danke/,
      );
    });
  });

  it("zeigt Fehlertext bei Backend-Reject", async () => {
    const api = makeFakeApi();
    api.submitFeedback.mockRejectedValueOnce(new Error("boom"));
    render(api);
    await userEvent.type(
      screen.getByTestId("feedback-message"),
      "Ein Feedback das vom Backend abgelehnt wird.",
    );
    await userEvent.click(screen.getByTestId("feedback-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("feedback-status").textContent).toMatch(
        /boom/,
      );
    });
  });
});
