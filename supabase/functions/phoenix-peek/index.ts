// Retired: kept deployed only so old links get a clear 410 instead of a 404.
Deno.serve(() => new Response("Gone", { status: 410 }));
