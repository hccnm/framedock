/** 让桌面渲染页通过同源 app:// 请求访问用户配置的 HTTP 服务。 */
export async function forwardDesktopRequest(request: Request): Promise<Response> {
    let target: URL;
    try {
        target = new URL(decodeURIComponent(new URL(request.url).pathname.slice("/proxy/".length)));
        if (!["http:", "https:"].includes(target.protocol)) throw new Error("unsupported protocol");
    } catch {
        return new Response("invalid proxy target", { status: 400 });
    }

    const headers = new Headers(request.headers);
    for (const name of ["host", "origin", "referer", "cookie", "content-length", "accept-encoding", "connection", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site"]) headers.delete(name);
    try {
        const upstream = await fetch(target, {
            method: request.method,
            headers,
            body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
            signal: request.signal,
            duplex: "half",
        } as RequestInit & { duplex: "half" });
        const responseHeaders = new Headers(upstream.headers);
        for (const name of ["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie"]) responseHeaders.delete(name);
        return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch (error) {
        const code = (error as { cause?: { code?: string } })?.cause?.code;
        const reason = code === "ECONNREFUSED" ? "连接被拒绝，请检查服务是否启动及地址、端口是否正确。" : code === "ENOTFOUND" ? "无法解析服务器地址，请检查地址是否正确。" : code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" ? "连接超时，请检查服务器和网络。" : "请求失败，请检查服务器和网络。";
        return Response.json({ error: { message: `无法连接上游服务 ${target.origin}：${reason}` } }, { status: 502 });
    }
}
