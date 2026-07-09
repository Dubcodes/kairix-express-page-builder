export function cookieParser(req, _res, next) {
  const header = req.headers.cookie || "";
  req.cookies = Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        const key = index === -1 ? part : part.slice(0, index);
        const value = index === -1 ? "" : part.slice(index + 1);
        return [decodeURIComponent(key), decodeURIComponent(value)];
      })
  );
  next();
}
