<script lang="ts">
  import { validateSpec } from "@bounty-judge/sdk";

  let activeTab = $state<"create" | "submit" | "judge">("create");

  // Create bounty state
  let title = $state("");
  let spec = $state("");
  let milestones = $state("Setup repo\nCore logic\nTests pass");
  let specIssues = $derived(validateSpec(spec));

  // Submit work state
  let bountyKey = $state("");
  let githubUrl = $state("");
  let notes = $state("");

  // Judge state
  let judgeKey = $state("");
  let judgeSubmitter = $state("");
</script>

<main class="max-w-3xl mx-auto p-6">
  <!-- Tabs -->
  <div class="flex gap-1 mb-8 bg-zinc-900 rounded-lg p-1">
    <button
      class="flex-1 py-2 rounded-md text-sm font-medium transition {activeTab === 'create' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}"
      onclick={() => (activeTab = "create")}
    >
      Post Bounty
    </button>
    <button
      class="flex-1 py-2 rounded-md text-sm font-medium transition {activeTab === 'submit' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}"
      onclick={() => (activeTab = "submit")}
    >
      Submit Work
    </button>
    <button
      class="flex-1 py-2 rounded-md text-sm font-medium transition {activeTab === 'judge' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}"
      onclick={() => (activeTab = "judge")}
    >
      Judge
    </button>
  </div>

  <!-- Create Bounty -->
  {#if activeTab === "create"}
    <div class="space-y-4">
      <h2 class="text-2xl font-bold">Post a Bounty</h2>
      <input
        class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
        placeholder="Bounty title"
        bind:value={title}
      />
      <div class="relative">
        <textarea
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 h-36 resize-none focus:border-amber-500 focus:outline-none"
          placeholder="Specification — what exactly must the worker deliver?"
          bind:value={spec}
        ></textarea>
        {#if spec && !specIssues.valid}
          <div class="mt-1 text-xs text-red-400">
            {#each specIssues.issues as issue}
              <p>⚠️ {issue}</p>
            {/each}
          </div>
        {/if}
      </div>
      <div>
        <label class="text-sm text-zinc-400 mb-1 block">Milestones (one per line)</label>
        <textarea
          class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white h-24 resize-none focus:border-amber-500 focus:outline-none"
          bind:value={milestones}
        ></textarea>
      </div>
      <button class="w-full bg-amber-600 hover:bg-amber-700 rounded-lg px-4 py-3 font-semibold transition">
        Create Bounty on GenLayer
      </button>
    </div>
  {/if}

  <!-- Submit Work -->
  {#if activeTab === "submit"}
    <div class="space-y-4">
      <h2 class="text-2xl font-bold">Submit Deliverable</h2>
      <input
        class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
        placeholder="Bounty key (e.g. 0)"
        bind:value={bountyKey}
      />
      <input
        class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
        placeholder="GitHub URL (repo or PR)"
        bind:value={githubUrl}
      />
      <textarea
        class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 h-24 resize-none focus:border-amber-500 focus:outline-none"
        placeholder="Notes — explain what you built and how it meets the spec"
        bind:value={notes}
      ></textarea>
      <button class="w-full bg-green-600 hover:bg-green-700 rounded-lg px-4 py-3 font-semibold transition">
        Submit Work
      </button>
    </div>
  {/if}

  <!-- Judge -->
  {#if activeTab === "judge"}
    <div class="space-y-4">
      <h2 class="text-2xl font-bold">Trigger AI Judgment</h2>
      <p class="text-zinc-400 text-sm">
        AI validators will fetch the code from GitHub, compare it against the bounty spec,
        and score each milestone individually.
      </p>
      <input
        class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
        placeholder="Bounty key"
        bind:value={judgeKey}
      />
      <input
        class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
        placeholder="Submitter address (0x...)"
        bind:value={judgeSubmitter}
      />
      <button class="w-full bg-red-600 hover:bg-red-700 rounded-lg px-4 py-3 font-semibold transition">
        ⚖️ Judge Submission
      </button>
    </div>
  {/if}

  <!-- How it works -->
  <div class="mt-10 bg-zinc-900 rounded-xl p-6 border border-zinc-800">
    <h3 class="font-semibold mb-3">How BountyJudge works</h3>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-zinc-400">
      <div class="space-y-1">
        <p class="text-amber-500 font-medium">1. Post</p>
        <p>Define spec + milestones. Lock BJT tokens in escrow.</p>
      </div>
      <div class="space-y-1">
        <p class="text-green-500 font-medium">2. Submit</p>
        <p>Worker builds it, submits GitHub URL.</p>
      </div>
      <div class="space-y-1">
        <p class="text-red-500 font-medium">3. Judge</p>
        <p>AI fetches code, scores per-milestone. Pass → payout. Fail → dispute.</p>
      </div>
    </div>
  </div>
</main>
