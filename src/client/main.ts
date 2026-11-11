import { createAuthClient } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";
import { validUsername, USERNAME_HELP } from "../shared/username";
import { hideModeCards, showModeCards } from "./cards";
import { motion } from "./motion";
import "./background";
import "./style.css";

const auth = createAuthClient({ plugins: [usernameClient()] });
const root = document.querySelector<HTMLElement>("main")!;
type User = NonNullable<
  Awaited<ReturnType<typeof auth.getSession>>["data"]
>["user"];
let currentUser: User | undefined;
let googleEnabled = false;
const requiredUsernamePath = "/change-username-required-1";
const unlinkGooglePath = "/unlink-google-required-setpw";
type AccountAction = {
  actionRequired?: boolean;
  actionRequiredReason?: string | null;
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const field = (
  name: string,
  label: string,
  type = "text",
  value = "",
  autocomplete = "",
  help = "",
) =>
  `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escape(value)}" autocomplete="${autocomplete}" required ${type === "password" ? 'minlength="7" maxlength="128"' : ""} ${name === "username" ? 'minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]{3,20}" autocapitalize="none" spellcheck="false" aria-describedby="username-help username-status"' : ""}>${help ? `<small class="help" id="${name}-help">${help}</small>` : ""}${name === "username" ? '<small class="help" id="username-status" role="status"></small>' : ""}</div>`;
// Google's standard "G" mark, as its sign-in branding guidelines require.
const GOOGLE_LOGO =
  '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const notice =
  '<div id="notice" class="notice" role="status" aria-live="polite"></div>';
function message(
  text: string,
  error = false,
  element = document.querySelector<HTMLElement>("#notice"),
) {
  if (element) {
    element.textContent = text;
    element.className = `notice ${error ? "error" : "success"}`;
  }
}
function navigate(path: string) {
  history.pushState({}, "", path);
  void render();
}
function bindForm(id: string, action: (data: FormData) => Promise<void>) {
  document
    .querySelector<HTMLFormElement>(`#${id}`)
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")];
      const button = form.querySelector<HTMLButtonElement>(
        "button[type=submit]",
      )!;
      const original = button.textContent;
      const data = new FormData(form);
      buttons.forEach((b) => (b.disabled = true));
      button.textContent = "Please wait…";
      try {
        await action(data);
      } catch (error) {
        message(
          error instanceof Error
            ? error.message
            : "Unable to connect. Please try again.",
          true,
        );
      } finally {
        buttons.forEach((b) => (b.disabled = false));
        button.textContent = original;
      }
    });
}
function check(result: {
  error?: { message?: string; status?: number } | null;
}) {
  if (result.error)
    throw new Error(
      result.error.status === 429
        ? "Too many attempts. Please wait a few minutes."
        : result.error.message || "Please try again.",
    );
}
function usernameAvailability() {
  const input = document.querySelector<HTMLInputElement>("#username");
  const output = document.querySelector<HTMLElement>("#username-status");
  if (!input || !output) return;
  let timer: ReturnType<typeof setTimeout>;
  let generation = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const ticket = ++generation;
    const value = input.value;
    input.setCustomValidity("");
    output.textContent = "";
    if (!validUsername(value)) {
      input.setCustomValidity("Choose a valid, unreserved username.");
      output.textContent = USERNAME_HELP;
      return;
    }
    if (value.toLowerCase() === currentUser?.username) return;
    timer = setTimeout(async () => {
      output.textContent = "Checking availability…";
      try {
        const result = await auth.isUsernameAvailable({ username: value });
        if (ticket !== generation || !output.isConnected) return;
        check(result);
        output.textContent = result.data?.available
          ? "Available"
          : "That username is taken.";
        input.setCustomValidity(
          result.data?.available ? "" : "That username is taken.",
        );
      } catch {
        if (ticket === generation)
          output.textContent =
            "Could not check availability. Try saving to check again.";
      }
    }, 450);
  });
}
function authLayout(signup: boolean) {
  root.innerHTML = `<div class="auth-layout"><section class="intro"><p class="eyebrow">retrac.space accounts</p><h1>Welcome to<br>retrac.space.</h1><p>The one account you use to access everything on retrac.space.</p></section><section class="panel" aria-label="${signup ? "Create account" : "Sign in"}"><button type="button" class="text-button back" id="back">← Back</button><h2>${signup ? "Find your space." : "Welcome back."}</h2><p class="subtle">${signup ? "Start with your email." : "Pick up where you left off."}</p><div id="auth-step"></div>${notice}<p class="fine">${signup ? "Keep your password safe. Password recovery is not available." : "Your account works across retrac.space."}</p></section></div>`;
  document.querySelector("#back")?.addEventListener("click", () => {
    root.querySelector(".auth-layout")?.classList.add("leaving");
    setTimeout(() => navigate("/"), motion.matches ? 0 : 280);
  });
  const destination =
    location.pathname === requiredUsernamePath || location.pathname === unlinkGooglePath
      ? location.pathname
      : "/settings";
  const step = document.querySelector<HTMLElement>("#auth-step")!;
  const focusFirst = () =>
    step.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus();

  // Step one: the email (or username) only.
  const identify = (value = "") => {
    step.innerHTML = `<form id="identify-form">${signup ? field("email", "Email", "email", value, "email") : field("identifier", "Username or email", "text", value, "username")}<button class="wide" type="submit">Next</button></form>`;
    bindForm("identify-form", async (data) => {
      const identifier = String(data.get(signup ? "email" : "identifier")).trim();
      const response = await fetch("/api/auth/unlink-google/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        signedIn?: boolean;
        redirect?: string;
        message?: string;
      };
      if (!response.ok)
        throw new Error(response.status === 429
          ? "Too many attempts. Please wait a few minutes."
          : result.message || "Please try again.");
      if (result.signedIn) {
        navigate(result.redirect || unlinkGooglePath);
        return;
      }
      credentials(identifier);
    });
  };

  // Step two: password (or a new account's details), or Google.
  const credentials = (identifier: string) => {
    message("");
    step.innerHTML = `<div class="identity"><span>${escape(identifier)}</span><button type="button" class="text-button" id="change-identity">Change</button></div><form id="auth-form"><input type="hidden" name="${signup ? "email" : "identifier"}" value="${escape(identifier)}" autocomplete="${signup ? "email" : "username"}">${signup ? field("username", "Username", "text", "", "username", USERNAME_HELP) : ""}${field("password", "Password", "password", "", signup ? "new-password" : "current-password", signup ? "At least 7 characters." : "")}<button class="wide" type="submit">${signup ? "Create account" : "Sign in"}</button></form>${googleEnabled ? `<div class="divider">or</div><button id="google" class="secondary wide">${GOOGLE_LOGO}Continue with Google</button>` : ""}`;
    document.querySelector("#change-identity")?.addEventListener("click", () => {
      message("");
      identify(identifier);
      focusFirst();
    });
    bindForm("auth-form", async (data) => {
      const password = String(data.get("password"));
      if (signup) {
        const username = String(data.get("username"));
        check(
          await auth.signUp.email({ username, name: username, email: identifier, password }),
        );
      } else {
        check(
          identifier.includes("@")
            ? await auth.signIn.email({ email: identifier, password })
            : await auth.signIn.username({ username: identifier, password }),
        );
      }
      navigate(destination);
    });
    document
      .querySelector("#google")
      ?.addEventListener("click", async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        try {
          check(
            await auth.signIn.social({
              provider: "google",
              callbackURL: destination,
              errorCallbackURL: "/sign-in?error=oauth",
            }),
          );
        } catch {
          message("Unable to continue with Google. Please try again.", true);
          button.disabled = false;
        }
      });
    usernameAvailability();
    focusFirst();
  };

  identify();
}
function simple(title: string, description: string, content: string) {
  root.innerHTML = `<section class="single panel"><h1>${title}</h1><p class="subtle">${description}</p>${content}${notice}<p class="fine"><a href="/sign-in" data-nav>Back to sign in</a></p></section>`;
}
async function render() {
  document.title = "Account · retrac.space";
  const session = await auth.getSession();
  if (session.error) {
    simple(
      "Unable to connect",
      "Your account could not be loaded. Please try again.",
      '<button id="retry" class="wide">Try again</button>',
    );
    document
      .querySelector("#retry")
      ?.addEventListener("click", () => void render());
    return;
  }
  currentUser = session.data?.user;
  const path = location.pathname;
  const form = path === "/sign-in" || path === "/sign-up";
  const required = path === requiredUsernamePath || path === unlinkGooglePath;
  if (currentUser || form || required) await hideModeCards();
  else showModeCards();
  if (currentUser) {
    if (path === requiredUsernamePath) renderRequiredUsername(currentUser);
    else if (path === unlinkGooglePath) renderUnlinkGoogle(currentUser);
    else if (!currentUser.username) renderUsername();
    else renderSettings(currentUser);
  } else if (required) {
    authLayout(false);
  } else if (!form) {
    root.innerHTML = "";
  } else {
    authLayout(path === "/sign-up");
    const params = new URLSearchParams(location.search);
    if (params.has("error"))
      message("Sign-in could not be completed. Please try again.", true);
    else if (params.has("deleted")) message("Your account has been deleted.");
  }
  root.querySelector("h1, h2")?.setAttribute("tabindex", "-1");
  if (document.activeElement === document.body)
    (root.querySelector("h1, h2") as HTMLElement)?.focus({
      preventScroll: true,
    });
}
function renderUsername() {
  simple(
    "What should we call you?",
    "Choose your unique username to finish setting up your account.",
    `<form id="choose">${field("username", "Username", "text", "", "username", USERNAME_HELP)}<button type="submit" class="wide">Save username</button></form><button class="text-button" id="signout">Sign out</button>`,
  );
  bindForm("choose", async (data) => {
    check(
      await auth.updateUser({
        username: String(data.get("username")),
        displayUsername: String(data.get("username")),
      }),
    );
    navigate("/settings");
  });
  usernameAvailability();
  bindSignout();
}
function renderRequiredUsername(user: User) {
  const action = user as User & AccountAction;
  document.title = "Change username ? retrac.space";
  if (action.actionRequiredReason !== "inappropriate_username") {
    root.innerHTML = `<section class="single panel"><h1>No username change required</h1><p class="subtle">There is no inappropriate username issue to resolve on this account.</p><a class="button wide" href="/settings" data-nav>Account settings</a></section>`;
    return;
  }
  root.innerHTML = `<section class="single panel"><h1>You need to change your username</h1><p class="subtle">Your previous username was flagged as inappropriate or not allowed. Please choose a new username to resolve this issue.</p><form id="required-username">${field("username", "Username", "text", user.username ?? "", "username", USERNAME_HELP)}<button type="submit" class="wide">Change username</button></form>${notice}<button class="text-button" id="signout">Sign out</button></section>`;
  usernameAvailability();
  bindSignout();
  bindForm("required-username", async (data) => {
    const username = String(data.get("username"));
    if (username.toLowerCase() === user.username?.toLowerCase())
      throw new Error("Please choose a different username.");
    const response = await fetch("/api/auth/update-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, resolveInappropriateUsername: true }),
    });
    const result = await response.json() as { message?: string };
    if (!response.ok)
      throw new Error(response.status === 429
        ? "Too many attempts. Please wait a few minutes."
        : result.message || "Unable to save your username. Please try again.");
    const session = await auth.getSession();
    check(session);
    currentUser = session.data?.user;
    const currentAction = currentUser as (User & AccountAction) | undefined;
    if (!currentUser || currentAction?.actionRequired) {
      await render();
      message("Your username was saved. Your account still requires attention.");
      return;
    }
    document.title = "Username updated ? retrac.space";
    root.innerHTML = `<section class="single panel username-success" role="status"><svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12 3 3 6-6"/></svg><h1 tabindex="-1">Username updated successfully</h1><p class="subtle">Your username has been changed, and your account issue has been resolved. You can now return to wherever you were and continue using your account.</p></section>`;
    root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  });
}
function renderUnlinkGoogle(user: User) {
  document.title = "Set a password · retrac.space";
  if ((user as User & AccountAction).actionRequiredReason !== "auth_unlink_google") {
    root.innerHTML = `<section class="single panel"><h1>No action required</h1><p class="subtle">Your account does not need a new password.</p><a class="button wide" href="/settings" data-nav>Account settings</a></section>`;
    return;
  }
  root.innerHTML = `<section class="single panel"><h1>Sign in with Google is no longer available</h1><p class="subtle">Sign in with Google is no longer available for your account, so you'll need to set a password. Once you set a password, your Google account will be unlinked.</p><form id="unlink-google-form"><input type="hidden" name="username" value="${escape(user.username ?? user.email)}" autocomplete="username">${field("newPassword", "New password", "password", "", "new-password", "At least 7 characters. Password recovery is not available.")}${field("confirmPassword", "Confirm password", "password", "", "new-password")}<button type="submit" class="wide">Set password</button></form>${notice}<button class="text-button" id="signout">Sign out</button></section>`;
  bindSignout();
  bindForm("unlink-google-form", async (data) => {
    const password = String(data.get("newPassword"));
    if (password !== String(data.get("confirmPassword")))
      throw new Error("Passwords do not match.");
    const response = await fetch("/api/auth/unlink-google/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newPassword: password }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      username?: string | null;
      email?: string;
      message?: string;
    };
    if (!response.ok)
      throw new Error(response.status === 429
        ? "Too many attempts. Please wait a few minutes."
        : result.message || "Unable to set your password. Please try again.");
    const session = await auth.getSession();
    if (!session.error) currentUser = session.data?.user ?? currentUser;
    const username = result.username ?? user.username ?? "";
    const email = result.email ?? user.email;
    document.title = "Password set · retrac.space";
    root.innerHTML = `<section class="single panel username-success" role="status"><svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12 3 3 6-6"/></svg><h1 tabindex="-1">Your password is set</h1><p class="subtle">Your Google account has been unlinked. You can now go back to wherever you were and sign in with these details from now on.</p><dl class="login-details"><div><dt>Username</dt><dd>${escape(username)}</dd></div><div><dt>Email</dt><dd>${escape(email)}</dd></div><div><dt>Password</dt><dd class="reveal"><span id="password-value">${"•".repeat(Math.min(password.length, 16))}</span><button type="button" class="text-button" id="reveal-password" aria-pressed="false">Show</button></dd></div></dl></section>`;
    const value = root.querySelector<HTMLElement>("#password-value")!;
    const toggle = root.querySelector<HTMLButtonElement>("#reveal-password")!;
    toggle.addEventListener("click", () => {
      const shown = toggle.getAttribute("aria-pressed") !== "true";
      value.textContent = shown ? password : "•".repeat(Math.min(password.length, 16));
      toggle.textContent = shown ? "Hide" : "Show";
      toggle.setAttribute("aria-pressed", String(shown));
    });
    root.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  });
}
function bindSignout() {
  document.querySelector("#signout")?.addEventListener("click", async () => {
    try {
      check(await auth.signOut());
      navigate("/sign-in");
    } catch {
      message("Unable to sign out. Please try again.", true);
    }
  });
}
function renderSettings(user: User) {
  root.innerHTML = `<div class="settings"><section class="panel profile"><div class="avatar" aria-hidden="true">${escape(user.username!.charAt(0).toUpperCase())}</div><div class="profile-text"><p class="eyebrow">Your account</p><h1>Hey, ${escape(user.username!)}.</h1><p class="subtle">${escape(user.email)}</p></div><button class="secondary" id="signout">Sign out</button></section>${notice}<div class="dashboard"><section class="panel"><p class="card-label">Profile</p><h2>Username</h2><p class="subtle">How you are known across retrac.space.</p><form id="username-form">${field("username", "Username", "text", user.username!, "username", USERNAME_HELP)}<button type="submit">Save username</button></form></section><section class="panel"><p class="card-label">Sign-in</p><h2>Email</h2><p class="subtle">${escape(user.email)}</p><div id="email-area"><p class="help">Loading sign-in methods...</p></div></section><section class="panel"><p class="card-label">Security</p><h2>Password</h2><p class="subtle">Keep it safe. There is no password recovery.</p><div id="password-area"></div></section><section class="panel danger"><p class="card-label">Danger zone</p><h2>Delete account</h2><p class="subtle">Permanently remove your account and its sign-in data.</p><details><summary>Delete my account</summary><p>This cannot be undone. You will lose access to this identity across retrac.space.</p><div id="delete-area"></div></details></section></div></div>`;
  const reason = (user as User & AccountAction).actionRequiredReason;
  if (reason === "inappropriate_username" || reason === "auth_unlink_google") {
    const link = document.createElement("a");
    link.href = reason === "auth_unlink_google" ? unlinkGooglePath : requiredUsernamePath;
    link.dataset.nav = "";
    link.className = "button secondary wide";
    link.textContent = "Resolve account issue";
    root.querySelector(".profile")?.after(link);
  }
  bindSignout();
  usernameAvailability();
  bindForm("username-form", async (data) => {
    const username = String(data.get("username"));
    check(await auth.updateUser({ username, displayUsername: username }));
    await render();
    message("Username saved.");
  });
  void sensitiveSettings(user);
}
async function sensitiveSettings(user: User) {
  const result = await auth.listAccounts();
  const area = document.querySelector("#password-area");
  if (!area) return;
  if (result.error) {
    area.textContent = "Could not load sign-in methods. Refresh to try again.";
    return;
  }
  const credential = result.data?.some(
    (account) => account.providerId === "credential",
  );
  area.innerHTML = credential
    ? `<form id="password-form">${field("currentPassword", "Current password", "password", "", "current-password")}${field("newPassword", "New password", "password", "", "new-password", "At least 7 characters.")}<button type="submit">Change password</button><p class="fine">Your other sessions will be signed out.</p></form>`
    : '<p class="subtle">You sign in with Google. Your password is managed by Google.</p>';
  document.querySelector("#email-area")!.innerHTML = credential
    ? `<form id="email-form">${field("email", "New email address", "email", "", "email")}${field("emailPassword", "Current password", "password", "", "current-password")}<button type="submit">Change email</button></form>`
    : '<p class="subtle">Your email is managed by Google.</p>';
  document.querySelector("#delete-area")!.innerHTML =
    `<form id="delete-form">${field("confirmation", "Type your username to confirm")}${credential ? field("deletePassword", "Current password", "password", "", "current-password") : '<p class="fine">Sign in again with Google before deleting if your session is more than 10 minutes old.</p>'}<button type="submit">Delete account permanently</button></form>`;
  bindForm("email-form", async (data) => {
    const response = await fetch("/api/auth/change-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        newEmail: String(data.get("email")),
        password: String(data.get("emailPassword")),
      }),
    });
    if (!response.ok)
      throw new Error(
        "Unable to change email. Check your password and try again.",
      );
    await render();
    const changed =
      currentUser?.email.toLowerCase() ===
      String(data.get("email")).toLowerCase();
    message(
      changed
        ? "Email changed."
        : "That email could not be used. Try another address.",
      !changed,
    );
  });
  bindForm("password-form", async (data) => {
    check(
      await auth.changePassword({
        currentPassword: String(data.get("currentPassword")),
        newPassword: String(data.get("newPassword")),
        revokeOtherSessions: true,
      }),
    );
    document.querySelector<HTMLFormElement>("#password-form")?.reset();
    message("Password changed. Other sessions have been signed out.");
  });
  bindForm("delete-form", async (data) => {
    if (data.get("confirmation") !== user.username)
      throw new Error("Type your username exactly to confirm.");
    check(
      await auth.deleteUser({
        ...(credential ? { password: String(data.get("deletePassword")) } : {}),
        callbackURL: "/sign-in?deleted=1",
      }),
    );
    navigate("/sign-in?deleted=1");
  });
}
document.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
    "a[data-nav]",
  );
  if (
    link &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    event.button === 0
  ) {
    event.preventDefault();
    navigate(link.pathname + link.search);
  }
});
addEventListener("popstate", () => void render());
async function start() {
  try {
    const response = await fetch("/api/config");
    if (response.ok)
      googleEnabled = ((await response.json()) as { google: boolean }).google;
    await render();
  } catch {
    simple("Unable to connect", "Please refresh the page to try again.", "");
  }
}
void start();
