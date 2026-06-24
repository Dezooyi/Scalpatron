import { useState } from "react";
import { Sliders, Zap, Clock, Eye, Move, Sparkles, Circle, Hexagon, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPicker } from "@/components/ui/color-picker";
import { SubTabs, type SubTabItem } from "@/components/ui/sub-tabs";
import {
  loadAnimationConfig,
  saveAnimationConfig,
  type AnimationConfig,
  type EaseType,
  type BackgroundPulseVariant,
} from "@/lib/animationConfig";

type Props = {
  onConfigChange?: (config: AnimationConfig) => void;
};

type SectionId = "trade" | "background" | "botchip";

const SECTION_TABS: SubTabItem<SectionId>[] = [
  { id: "trade",      label: "Trade Flash",       icon: Zap    },
  { id: "background", label: "Background Pulse",  icon: Circle },
  { id: "botchip",    label: "Bot Chip",          icon: Hexagon },
];

export default function AnimationSettings({ onConfigChange }: Props) {
  // Lazy initializer: read fresh from localStorage on every mount.
  // AnimationSettings is conditionally mounted (settings tab), so a module-level
  // snapshot would go stale across tab switches and silently revert saved values.
  const [config, setConfig] = useState<AnimationConfig>(() => loadAnimationConfig());
  const [saved, setSaved] = useState(false);
  const [expandedSection, setExpandedSection] = useState<SectionId>("trade");

  const updateConfig = <K extends keyof AnimationConfig>(
    key: K,
    value: AnimationConfig[K]
  ) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    saveAnimationConfig(newConfig);
    onConfigChange?.(newConfig);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleNumberChange = (
    key: keyof AnimationConfig,
    value: string,
    min: number,
    max: number
  ) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= min && num <= max) {
      updateConfig(key, num);
    }
  };

  return (
    <Card className="border-purple-500/20">
      <CardHeader>
        <div className="flex items-center gap-3 mb-2">
          <Sliders className="h-6 w-6 text-purple-400" />
          <div>
            <CardTitle className="text-xl">Animation Configuration</CardTitle>
            <CardDescription className="mt-1">
              Global settings for all animations
            </CardDescription>
          </div>
        </div>
        
        {/* Section Toggles */}
        <div className="mt-3">
          <SubTabs tabs={SECTION_TABS} active={expandedSection} onChange={setExpandedSection} />
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Global Toggles (immer sichtbar) */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs">
              <Zap className="w-3.5 h-3.5" />
              All Animations
            </Label>
            <Button
              variant={config.enabled ? "default" : "outline"}
              size="sm"
              onClick={() => updateConfig("enabled", !config.enabled)}
              className="w-full text-xs"
            >
              {config.enabled ? "ON" : "OFF"}
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs">
              <Circle className="w-3.5 h-3.5" />
              Background Pulse
            </Label>
            <Button
              variant={config.backgroundPulseEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => updateConfig("backgroundPulseEnabled", !config.backgroundPulseEnabled)}
              className="w-full text-xs"
            >
              {config.backgroundPulseEnabled ? "ON" : "OFF"}
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-2 text-xs">
              <Hexagon className="w-3.5 h-3.5" />
              Bot Chip
            </Label>
            <Button
              variant={config.botChipAnimationEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => updateConfig("botChipAnimationEnabled", !config.botChipAnimationEnabled)}
              className="w-full text-xs"
            >
              {config.botChipAnimationEnabled ? "ON" : "OFF"}
            </Button>
          </div>
        </div>

        {/* TRADE FLASH SECTION */}
        {expandedSection === "trade" && (
          <>
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-green-400 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Pulse Phase (Initial Flash)
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Duration (s)</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="1"
                    value={config.pulseDuration}
                    onChange={(e) => handleNumberChange("pulseDuration", e.target.value, 0.05, 1)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Intensity (0-1)</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="1"
                    value={config.pulseIntensity}
                    onChange={(e) => handleNumberChange("pulseIntensity", e.target.value, 0.1, 1)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Blur (px)</Label>
                  <Input
                    type="number"
                    step="5"
                    min="10"
                    max="100"
                    value={config.pulseBlur}
                    onChange={(e) => handleNumberChange("pulseBlur", e.target.value, 10, 100)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Spread (px)</Label>
                  <Input
                    type="number"
                    step="2"
                    min="0"
                    max="50"
                    value={config.pulseSpread}
                    onChange={(e) => handleNumberChange("pulseSpread", e.target.value, 0, 50)}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium text-yellow-400 flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Hold Phase (Decay)
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Duration (s)</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="2"
                    value={config.holdDuration}
                    onChange={(e) => handleNumberChange("holdDuration", e.target.value, 0.05, 2)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Intensity (0-1)</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="0.5"
                    value={config.holdIntensity}
                    onChange={(e) => handleNumberChange("holdIntensity", e.target.value, 0.05, 0.5)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Blur (px)</Label>
                  <Input
                    type="number"
                    step="5"
                    min="5"
                    max="50"
                    value={config.holdBlur}
                    onChange={(e) => handleNumberChange("holdBlur", e.target.value, 5, 50)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Spread (px)</Label>
                  <Input
                    type="number"
                    step="2"
                    min="0"
                    max="30"
                    value={config.holdSpread}
                    onChange={(e) => handleNumberChange("holdSpread", e.target.value, 0, 30)}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium text-red-400 flex items-center gap-2">
                <Eye className="w-4 h-4" />
                Fade-Out Phase
              </h4>
              <div className="max-w-[200px]">
                <div className="space-y-1">
                  <Label className="text-xs">Duration (s)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.5"
                    max="5"
                    value={config.fadeDuration}
                    onChange={(e) => handleNumberChange("fadeDuration", e.target.value, 0.5, 5)}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* BACKGROUND PULSE SECTION */}
        {expandedSection === "background" && (
          <>
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-cyan-400 flex items-center gap-2">
                <Circle className="w-4 h-4" />
                Variant
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <Button
                  variant={config.bgPulseVariant === "gradient" ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateConfig("bgPulseVariant", "gradient" as BackgroundPulseVariant)}
                  className="w-full text-xs"
                >
                  Gradient
                </Button>
                <Button
                  variant={config.bgPulseVariant === "orb" ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateConfig("bgPulseVariant", "orb" as BackgroundPulseVariant)}
                  className="w-full text-xs"
                >
                  Orb
                </Button>
                <Button
                  variant={config.bgPulseVariant === "equity" ? "default" : "outline"}
                  size="sm"
                  onClick={() => updateConfig("bgPulseVariant", "equity" as BackgroundPulseVariant)}
                  className="w-full text-xs"
                >
                  Equity
                </Button>
              </div>
            </div>

            {config.bgPulseVariant === "orb" && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-purple-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Orb Geometry
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Count</Label>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      max="6"
                      value={config.bgPulseOrbCount}
                      onChange={(e) => handleNumberChange("bgPulseOrbCount", e.target.value, 1, 6)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Base Size (px)</Label>
                    <Input
                      type="number"
                      step="10"
                      min="100"
                      max="800"
                      value={config.bgPulseOrbBaseSize}
                      onChange={(e) => handleNumberChange("bgPulseOrbBaseSize", e.target.value, 100, 800)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Spacing (px)</Label>
                    <Input
                      type="number"
                      step="10"
                      min="0"
                      max="300"
                      value={config.bgPulseOrbSpacing}
                      onChange={(e) => handleNumberChange("bgPulseOrbSpacing", e.target.value, 0, 300)}
                      className="text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Movement (px)</Label>
                    <Input
                      type="number"
                      step="2"
                      min="0"
                      max="120"
                      value={config.bgPulseOrbMovement}
                      onChange={(e) => handleNumberChange("bgPulseOrbMovement", e.target.value, 0, 120)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Idle Speed (s)</Label>
                    <Input
                      type="number"
                      step="0.2"
                      min="1"
                      max="8"
                      value={config.bgPulseOrbIdleDuration}
                      onChange={(e) => handleNumberChange("bgPulseOrbIdleDuration", e.target.value, 1, 8)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fill Opacity</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={config.bgPulseOrbFillOpacity}
                      onChange={(e) => handleNumberChange("bgPulseOrbFillOpacity", e.target.value, 0, 1)}
                      className="text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 max-w-[300px]">
                  <div className="space-y-1">
                    <Label className="text-xs">Border Opacity</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={config.bgPulseOrbBorderOpacity}
                      onChange={(e) => handleNumberChange("bgPulseOrbBorderOpacity", e.target.value, 0, 1)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Glow Opacity</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      max="1"
                      value={config.bgPulseOrbGlowOpacity}
                      onChange={(e) => handleNumberChange("bgPulseOrbGlowOpacity", e.target.value, 0, 1)}
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-pink-400 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Orb Colors (RGBA)
                  </h4>
                  <div className="grid grid-cols-3 gap-3">
                    <ColorPicker
                      label="Fill Color"
                      value={config.bgPulseOrbFillColor}
                      onChange={(v) => updateConfig("bgPulseOrbFillColor", v)}
                    />
                    <ColorPicker
                      label="Border Color"
                      value={config.bgPulseOrbBorderColor}
                      onChange={(v) => updateConfig("bgPulseOrbBorderColor", v)}
                    />
                    <ColorPicker
                      label="Glow Color"
                      value={config.bgPulseOrbGlowColor}
                      onChange={(v) => updateConfig("bgPulseOrbGlowColor", v)}
                    />
                  </div>
                </div>
              </div>
            )}

            {config.bgPulseVariant === "equity" && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-emerald-400 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Equity Echo
                </h4>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Repeat Count</Label>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      max="8"
                      value={config.bgPulseEquityRepeat}
                      onChange={(e) => handleNumberChange("bgPulseEquityRepeat", e.target.value, 1, 8)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fade Step</Label>
                    <Input
                      type="number"
                      step="0.02"
                      min="0"
                      max="0.5"
                      value={config.bgPulseEquityFadeStep}
                      onChange={(e) => handleNumberChange("bgPulseEquityFadeStep", e.target.value, 0, 0.5)}
                      className="text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Spacing (%)</Label>
                    <Input
                      type="number"
                      step="1"
                      min="0"
                      max="40"
                      value={config.bgPulseEquitySpacing}
                      onChange={(e) => handleNumberChange("bgPulseEquitySpacing", e.target.value, 0, 40)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Scale Step</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="0.3"
                      value={config.bgPulseEquityScaleStep}
                      onChange={(e) => handleNumberChange("bgPulseEquityScaleStep", e.target.value, 0, 0.3)}
                      className="text-xs"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Stroke Width (px)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max="6"
                      value={config.bgPulseEquityStrokeWidth}
                      onChange={(e) => handleNumberChange("bgPulseEquityStrokeWidth", e.target.value, 0.5, 6)}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fill Opacity</Label>
                    <Input
                      type="number"
                      step="0.05"
                      min="0"
                      max="0.8"
                      value={config.bgPulseEquityFillOpacity}
                      onChange={(e) => handleNumberChange("bgPulseEquityFillOpacity", e.target.value, 0, 0.8)}
                      className="text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              <h4 className="text-sm font-medium text-cyan-400 flex items-center gap-2">
                <Circle className="w-4 h-4" />
                Frost Glass Overlay
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Enabled</Label>
                  <Button
                    variant={config.bgPulseFrostEnabled ? "default" : "outline"}
                    size="sm"
                    onClick={() => updateConfig("bgPulseFrostEnabled", !config.bgPulseFrostEnabled)}
                    className="w-full text-xs"
                  >
                    {config.bgPulseFrostEnabled ? "ON" : "OFF"}
                  </Button>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Blur (px)</Label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    max="40"
                    value={config.bgPulseFrostBlur}
                    onChange={(e) => handleNumberChange("bgPulseFrostBlur", e.target.value, 0, 40)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Opacity</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={config.bgPulseFrostOpacity}
                    onChange={(e) => handleNumberChange("bgPulseFrostOpacity", e.target.value, 0, 1)}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>

            {config.bgPulseVariant === "gradient" && (
              <>
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-cyan-400 flex items-center gap-2">
                    <Circle className="w-4 h-4" />
                    Initial Scale & Colors
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Initial Scale</Label>
                      <Input
                        type="number"
                        step="0.005"
                        min="0.01"
                        max="0.1"
                        value={config.bgPulseInitialScale}
                        onChange={(e) => handleNumberChange("bgPulseInitialScale", e.target.value, 0.01, 0.1)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Expand Duration (s)</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="0.1"
                        max="0.5"
                        value={config.bgPulseExpandDuration}
                        onChange={(e) => handleNumberChange("bgPulseExpandDuration", e.target.value, 0.1, 0.5)}
                        className="text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-purple-400 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Expand Phase 1 (Wabernd)
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Circle 1 Scale</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="1"
                        max="3"
                        value={config.bgPulseExpand1Scale}
                        onChange={(e) => handleNumberChange("bgPulseExpand1Scale", e.target.value, 1, 3)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Circle 2 Scale</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="1"
                        max="3"
                        value={config.bgPulseExpand2Scale}
                        onChange={(e) => handleNumberChange("bgPulseExpand2Scale", e.target.value, 1, 3)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Circle 3 Scale</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="1"
                        max="3"
                        value={config.bgPulseExpand3Scale}
                        onChange={(e) => handleNumberChange("bgPulseExpand3Scale", e.target.value, 1, 3)}
                        className="text-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Opacity 1</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="0.1"
                        max="1"
                        value={config.bgPulseOpacity1}
                        onChange={(e) => handleNumberChange("bgPulseOpacity1", e.target.value, 0.1, 1)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Opacity 2</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="0.1"
                        max="1"
                        value={config.bgPulseOpacity2}
                        onChange={(e) => handleNumberChange("bgPulseOpacity2", e.target.value, 0.1, 1)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Opacity 3</Label>
                      <Input
                        type="number"
                        step="0.05"
                        min="0.1"
                        max="1"
                        value={config.bgPulseOpacity3}
                        onChange={(e) => handleNumberChange("bgPulseOpacity3", e.target.value, 0.1, 1)}
                        className="text-xs"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-blue-400 flex items-center gap-2">
                    <Move className="w-4 h-4" />
                    Billowing Phase 2 (Slow)
                  </h4>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Circle 1 Scale</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="2"
                        max="5"
                        value={config.bgPulseBillow1Scale}
                        onChange={(e) => handleNumberChange("bgPulseBillow1Scale", e.target.value, 2, 5)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Circle 2 Scale</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="2"
                        max="5"
                        value={config.bgPulseBillow2Scale}
                        onChange={(e) => handleNumberChange("bgPulseBillow2Scale", e.target.value, 2, 5)}
                        className="text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Circle 3 Scale</Label>
                      <Input
                        type="number"
                        step="0.1"
                        min="2"
                        max="5"
                        value={config.bgPulseBillow3Scale}
                        onChange={(e) => handleNumberChange("bgPulseBillow3Scale", e.target.value, 2, 5)}
                        className="text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Billow Duration (s)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min="1"
                      max="5"
                      value={config.bgPulseBillowDuration}
                      onChange={(e) => handleNumberChange("bgPulseBillowDuration", e.target.value, 1, 5)}
                      className="text-xs"
                    />
                  </div>
                </div>
              </>
            )}

            <div className="space-y-3">
              <h4 className="text-sm font-medium text-pink-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Colors (RGBA)
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <ColorPicker
                  label="AI Update Color"
                  value={config.bgPulseColorAI}
                  onChange={(v) => updateConfig("bgPulseColorAI", v)}
                />
                <ColorPicker
                  label="Buy Signal Color"
                  value={config.bgPulseColorBuy}
                  onChange={(v) => updateConfig("bgPulseColorBuy", v)}
                />
                <ColorPicker
                  label="Sell Signal Color"
                  value={config.bgPulseColorSell}
                  onChange={(v) => updateConfig("bgPulseColorSell", v)}
                />
                <ColorPicker
                  label="Tick Color"
                  value={config.bgPulseColorTick}
                  onChange={(v) => updateConfig("bgPulseColorTick", v)}
                />
              </div>
            </div>
          </>
        )}

        {/* BOT CHIP SECTION */}
        {expandedSection === "botchip" && (
          <>
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-orange-400 flex items-center gap-2">
                <Hexagon className="w-4 h-4" />
                Border Animation
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Rotation Speed (s)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    min="2"
                    max="20"
                    value={config.botChipBorderSpeed}
                    onChange={(e) => handleNumberChange("botChipBorderSpeed", e.target.value, 2, 20)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Border Opacity</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="1"
                    value={config.botChipBorderOpacity}
                    onChange={(e) => handleNumberChange("botChipBorderOpacity", e.target.value, 0.1, 1)}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-sm font-medium text-emerald-400 flex items-center gap-2">
                <Circle className="w-4 h-4" />
                Radial Glow
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Glow Radius (px)</Label>
                  <Input
                    type="number"
                    step="1"
                    min="5"
                    max="30"
                    value={config.botChipGlowRadius}
                    onChange={(e) => handleNumberChange("botChipGlowRadius", e.target.value, 5, 30)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Glow Opacity</Label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0.1"
                    max="0.8"
                    value={config.botChipGlowOpacity}
                    onChange={(e) => handleNumberChange("botChipGlowOpacity", e.target.value, 0.1, 0.8)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Glow Scale</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.9"
                    max="1.2"
                    value={config.botChipGlowScale}
                    onChange={(e) => handleNumberChange("botChipGlowScale", e.target.value, 0.9, 1.2)}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* Easing (immer sichtbar) */}
        <div className="space-y-2">
          <Label className="text-sm">Easing Function</Label>
          <select
            value={config.easeType}
            onChange={(e) => updateConfig("easeType", e.target.value as EaseType)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-sm"
          >
            <option value="power1.inOut">power1.inOut (smooth)</option>
            <option value="power2.inOut">power2.inOut (balanced)</option>
            <option value="power3.inOut">power3.inOut (strong)</option>
            <option value="power4.inOut">power4.inOut (very strong)</option>
            <option value="back.inOut">back.inOut (with overshoot)</option>
            <option value="elastic.inOut">elastic.inOut (elastic)</option>
            <option value="bounce.inOut">bounce.inOut (bouncy)</option>
          </select>
        </div>

        {/* Save Status */}
        {saved && (
          <div className="text-xs text-green-400 text-center py-2">
            Configuration saved!
          </div>
        )}

        {/* Reset Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const defaults = loadAnimationConfig();
            setConfig(defaults);
            saveAnimationConfig(defaults);
            onConfigChange?.(defaults);
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
          className="w-full"
        >
          Reset to Defaults
        </Button>
      </CardContent>
    </Card>
  );
}
