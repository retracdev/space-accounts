import { createAuthClient } from "better-auth/client";
import { usernameClient } from "better-auth/client/plugins";
import { validUsername, USERNAME_HELP } from "../shared/username";
import { showModeCards } from "./cards";
import "./background";
import "./style.css";

const auth = createAuthClient({ plugins: [usernameClient()] });
const root = document.querySelector<HTMLElement>("main")!;
type User = NonNullable<
  Awaited<ReturnType<typeof auth.getSession>>["data"]
>["user"];
let currentUser: User | undefined;
let googleEnabled = false;
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
  `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escape(value)}" autocomplete="${autocomplete}" required ${type === "password" ? 'minlength="12" maxlength="128"' : ""} ${name === "username" ? 'minlength="3" maxlength="20" pattern="[a-zA-Z0-9_]{3,20}" autocapitalize="none" spellcheck="false" aria-describedby="username-help username-status"' : ""}>${help ? `<small class="help" id="${name}-help">${help}</small>` : ""}${name === "username" ? '<small class="help" id="username-status" role="status"></small>' : ""}</div>`;
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
  root.innerHTML = `<div class="auth-layout"><section class="intro"><p class="eyebrow">retrac.space accounts</p><h1>Your next move<br>starts here.</h1><p>The one account you use to access everything on retrac.space.</p><small>Make yourself at home.</small></section><section class="panel" aria-label="${signup ? "Create account" : "Sign in"}"><h2>${signup ? "Find your space." : "Welcome back."}</h2><p class="subtle">${signup ? "Choose the name you’ll play with." : "Pick up where you left off."}</p><form id="auth-form">${signup ? field("username", "Username", "text", "", "username", USERNAME_HELP) : field("identifier", "Username or email", "text", "", "username")}${signup ? field("email", "Email", "email", "", "email") : ""}${!signup ? '<div class="split"><label for="password">Password</label></div>' : ""}${field("password", signup ? "Password" : "Password", "password", "", signup ? "new-password" : "current-password", signup ? "At least 12 characters." : "")}<button class="wide" type="submit">${signup ? "Create account" : "Sign in"}</button></form>${googleEnabled ? '<div class="divider">or</div><button id="google" class="secondary wide">Continue with Google</button>' : ""}${notice}<p class="fine">${signup ? "Keep your password safe. Password recovery is not available." : "Your account works across retrac.space."}</p></section></div>`;
  if (!signup)
    document
      .querySelector(".field:has(#password) label")
      ?.setAttribute("hidden", "");
  bindForm("auth-form", async (data) => {
    const username = String(data.get(signup ? "username" : "identifier")),
      password = String(data.get("password"));
    if (signup) {
      check(
        await auth.signUp.email({
          username,
          name: username,
          email: String(data.get("email")),
          password,
        }),
      );
      navigate("/settings");
    } else {
      check(
        username.includes("@")
          ? await auth.signIn.email({ email: username, password })
          : await auth.signIn.username({ username, password }),
      );
      navigate("/settings");
    }
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
            callbackURL: "/settings",
            errorCallbackURL: "/sign-in?error=oauth",
          }),
        );
      } catch {
        message("Unable to continue with Google. Please try again.", true);
        button.disabled = false;
      }
    });
  usernameAvailability();
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
  showModeCards(currentUser ? null : path === "/sign-up" ? "sign-up" : "sign-in");
  if (currentUser) {
    if (!currentUser.username) renderUsername();
    else renderSettings(currentUser);
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
    ? `<form id="password-form">${field("currentPassword", "Current password", "password", "", "current-password")}${field("newPassword", "New password", "password", "", "new-password", "At least 12 characters.")}<button type="submit">Change password</button><p class="fine">Your other sessions will be signed out.</p></form>`
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
