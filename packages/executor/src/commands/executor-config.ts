import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { Effect } from "effect";

import { applyDisplayMode, formatDisplayModeLabel } from "../config/display-presets.ts";
import { globalExecutorPiConfigPath, projectExecutorPiConfigPath } from "../config/paths.ts";
import { saveGlobalExecutorPiSettings, saveProjectExecutorPiSettings } from "../config/store.ts";
import type { DisplayMode, ExecutorSettings } from "../schemas/settings.ts";
import { ConfigService } from "../services/config.ts";

const displayModeValues = ["concise", "balanced", "verbose", "custom"] as const;
const booleanValues = ["on", "off"] as const;
const codePreviewValues = ["24", "40", "80", "120"] as const;
const jsonByteValues = ["12000", "40000", "100000"] as const;
const logLineValues = ["40", "200", "500"] as const;
const configScopeValues = ["global", "project"] as const;

type ConfigScope = (typeof configScopeValues)[number];

const boolToOnOff = (value: boolean): string => (value ? "on" : "off");
const onOffToBool = (value: string): boolean => value === "on";

const buildSettingItems = (settings: ExecutorSettings, scope: ConfigScope): SettingItem[] => [
  {
    id: "displayMode",
    label: "Display density",
    description: "Concise keeps transcripts short. Verbose shows more detail by default.",
    currentValue: settings.displayMode,
    values: [...displayModeValues],
  },
  {
    id: "search.defaultIncludeDetails",
    label: "Search include details",
    description: "Default for includeDetails when the agent omits it on search.",
    currentValue: boolToOnOff(settings.search.defaultIncludeDetails),
    values: [...booleanValues],
  },
  {
    id: "search.showSourcesFooter",
    label: "Search sources footer",
    description: "Show configured source ids under search results.",
    currentValue: boolToOnOff(settings.search.showSourcesFooter),
    values: [...booleanValues],
  },
  {
    id: "maxCodePreviewLines",
    label: "Code preview lines",
    description: "Maximum lines shown in execute tool call previews.",
    currentValue: String(settings.render.maxCodePreviewLines),
    values: [...codePreviewValues],
  },
  {
    id: "maxJsonBytes",
    label: "Max JSON bytes",
    description: "Maximum structured output size before truncation.",
    currentValue: String(settings.render.maxJsonBytes),
    values: [...jsonByteValues],
  },
  {
    id: "maxLogLines",
    label: "Max log lines",
    description: "Maximum execute log lines shown in results.",
    currentValue: String(settings.render.maxLogLines),
    values: [...logLineValues],
  },
  {
    id: "saveScope",
    label: "Save to",
    description: "Global applies everywhere. Project overrides in .pi/executor-pi.json.",
    currentValue: scope,
    values: [...configScopeValues],
  },
];

const applySettingChange = (
  settings: ExecutorSettings,
  id: string,
  newValue: string,
): ExecutorSettings => {
  if (id === "displayMode") {
    const mode = newValue as DisplayMode;
    if (mode === "custom") {
      return { ...settings, displayMode: "custom" };
    }
    return applyDisplayMode(mode);
  }

  if (id === "search.defaultIncludeDetails") {
    return {
      ...settings,
      search: { ...settings.search, defaultIncludeDetails: onOffToBool(newValue) },
    };
  }

  if (id === "search.showSourcesFooter") {
    return {
      ...settings,
      search: { ...settings.search, showSourcesFooter: onOffToBool(newValue) },
    };
  }

  const render = { ...settings.render };
  if (id === "maxCodePreviewLines") {
    render.maxCodePreviewLines = Number(newValue);
  } else if (id === "maxJsonBytes") {
    render.maxJsonBytes = Number(newValue);
  } else if (id === "maxLogLines") {
    render.maxLogLines = Number(newValue);
  } else {
    return settings;
  }

  return {
    displayMode: "custom",
    render,
    search: { ...settings.search },
  };
};

const syncSettingsList = (settingsList: SettingsList, settings: ExecutorSettings): void => {
  settingsList.updateValue("displayMode", settings.displayMode);
  settingsList.updateValue(
    "search.defaultIncludeDetails",
    boolToOnOff(settings.search.defaultIncludeDetails),
  );
  settingsList.updateValue(
    "search.showSourcesFooter",
    boolToOnOff(settings.search.showSourcesFooter),
  );
  settingsList.updateValue("maxCodePreviewLines", String(settings.render.maxCodePreviewLines));
  settingsList.updateValue("maxJsonBytes", String(settings.render.maxJsonBytes));
  settingsList.updateValue("maxLogLines", String(settings.render.maxLogLines));
};

export const runExecutorConfigUi = (
  ctx: ExtensionCommandContext,
): Effect.Effect<void, never, ConfigService> =>
  Effect.gen(function* () {
    const config = yield* ConfigService;

    if (!ctx.hasUI) {
      const resolved = yield* config.resolve(ctx.cwd);
      ctx.ui.notify(
        [
          config.formatSettingsSummary(resolved.settings),
          "",
          "Interactive config requires a Pi TUI session. Edit JSON directly:",
          `  ${globalExecutorPiConfigPath()}`,
          `  ${projectExecutorPiConfigPath(ctx.cwd)}`,
        ].join("\n"),
        "info",
      );
      return;
    }

    let settings = (yield* config.resolve(ctx.cwd)).settings;
    let saveScope: ConfigScope = "global";

    const persist = (): Promise<void> =>
      Effect.runPromise(
        saveScope === "project"
          ? saveProjectExecutorPiSettings(ctx.cwd, settings)
          : saveGlobalExecutorPiSettings(settings),
      );

    yield* Effect.promise(() =>
      ctx.ui.custom((tui, theme, _keybindings, done) => {
        const container = new Container();
        container.addChild(new DynamicBorder((line) => theme.fg("accent", line)));
        container.addChild(new Text(theme.fg("accent", theme.bold("Executor Pi Settings")), 0, 0));
        container.addChild(
          new Text(
            theme.fg(
              "dim",
              "↑↓ navigate • enter/space change • esc close • changes save immediately",
            ),
            0,
            0,
          ),
        );

        const settingsList = new SettingsList(
          buildSettingItems(settings, saveScope),
          12,
          getSettingsListTheme(),
          (id, newValue) => {
            if (id === "saveScope") {
              saveScope = newValue as ConfigScope;
              settingsList.updateValue("saveScope", saveScope);
              tui.requestRender();
              return;
            }

            settings = applySettingChange(settings, id, newValue);

            void (async () => {
              try {
                await persist();
                syncSettingsList(settingsList, settings);
                ctx.ui.setStatus(
                  "executor",
                  `executor: ${formatDisplayModeLabel(settings.displayMode)}`,
                );
                tui.requestRender();
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.ui.notify(message, "error");
              }
            })();
          },
          () => {
            done(undefined);
          },
        );

        container.addChild(settingsList);
        container.addChild(new DynamicBorder((line) => theme.fg("accent", line)));

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            settingsList.handleInput?.(data);
            tui.requestRender();
          },
        };
      }),
    );

    const resolved = yield* config.resolve(ctx.cwd);
    ctx.ui.setStatus("executor", config.formatStatusBar(resolved.settings));
  });
