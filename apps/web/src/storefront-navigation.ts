export function storefrontTab(pathname: string, search = "", hash = "") {
  const params = new URLSearchParams(search);
  const category = params.get("category") || params.get("danh-muc");
  if (pathname === "/gifts" || category === "qua-tang") return "gifts";
  if (pathname === "/gioi-thieu") return "about";
  if (
    pathname === "/cua-hang" ||
    pathname.startsWith("/san-pham/") ||
    (pathname === "/" && (category || params.has("q") || hash === "#thuc-qua"))
  )
    return "shop";
  return pathname === "/" ? "home" : null;
}
