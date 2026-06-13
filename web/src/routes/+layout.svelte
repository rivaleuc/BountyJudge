<script>
  import "../app.css";
  let { children } = $props();
</script>

<div class="min-h-screen bg-zinc-950 text-white">
  <nav class="border-b border-zinc-800 px-6 py-4 flex justify-between items-center">
    <h1 class="text-xl font-bold">🏆 BountyJudge</h1>
    <span class="text-zinc-500 text-sm">Powered by GenLayer AI Consensus</span>
  </nav>
  {@render children()}
</div>
