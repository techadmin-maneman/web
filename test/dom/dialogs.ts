// jsdom draws a <dialog> but cannot open one as a modal: the console's drawers open as one, so a page's tests open
// them as jsdom can, by the attribute alone.

export function openDialogsAsJsdomCan(): void {
  Reflect.set(HTMLDialogElement.prototype, "showModal", function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  Reflect.set(HTMLDialogElement.prototype, "close", function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
}
