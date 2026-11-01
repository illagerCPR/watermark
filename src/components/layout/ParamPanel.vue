<script setup lang="ts">
import { computed } from 'vue'

import AppIcon from '@/components/ui/AppIcon.vue'
import FormField from '@/components/fields/FormField.vue'
import RangeField from '@/components/fields/RangeField.vue'
import SectionCard from '@/components/ui/SectionCard.vue'
import SwitchField from '@/components/fields/SwitchField.vue'
import { pushToast } from '@/composables/useToasts'
import { useParams } from '@/composables/useParams'
import {
  BLIND_MAX_BYTES,
  BLIND_MIN_SIZE,
  BLIND_TEXT_MAX_LENGTH,
  FONT_FAMILIES,
  LIMITS,
} from '@/core/constants'
import { blindTextByteLength } from '@/core/params'

withDefaults(defineProps<{ dismissible?: boolean; sheet?: boolean }>(), {
  dismissible: false,
  sheet: false,
})
const emit = defineEmits<{ close: [] }>()

const { params, resetParams } = useParams()

const blindBytes = computed(() => blindTextByteLength(params.blindText.trim()))
const blindTooLong = computed(() => blindBytes.value > BLIND_MAX_BYTES)
const blindEmpty = computed(() => params.blindText.trim().length === 0)

function resetAll(): void {
  resetParams()
  pushToast('已恢复默认参数', 'success')
}

function setFormat(value: string): void {
  params.format = value === 'jpeg' ? 'jpeg' : 'png'
}
</script>

<template>
  <aside
    class="flex h-full min-h-0 shrink-0 flex-col border-line bg-surface"
    :class="sheet ? 'w-full border-t' : 'w-[340px] border-l'"
  >
    <div class="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div class="flex items-center gap-2">
        <AppIcon name="sliders" :size="16" class="text-muted" />
        <h2 class="text-sm font-semibold text-ink">参数</h2>
      </div>
      <button
        v-if="dismissible"
        type="button"
        class="btn btn-ghost btn-icon"
        aria-label="收起参数面板"
        @click="emit('close')"
      >
        <AppIcon name="close" :size="16" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4">
      <SectionCard title="可见水印">
        <SwitchField
          v-model="params.tiledEnabled"
          label="平铺水印"
          hint="关闭后只导出原图；盲水印开关仍独立生效"
        />

        <FormField label="水印文本" hint="每一行独立绘制，不会自动换行">
          <template #aside>
            <span class="font-mono text-[11px] text-faint">{{ params.text.length }} 字</span>
          </template>
          <template #default="{ id }">
            <textarea
              :id="id"
              v-model="params.text"
              rows="3"
              spellcheck="false"
              class="field min-h-[76px] resize-y font-mono text-[13px] leading-relaxed"
              placeholder="输入水印文字，支持多行"
            />
          </template>
        </FormField>

        <FormField label="文本字体">
          <template #default="{ id }">
            <select :id="id" v-model="params.fontFamily" class="field">
              <option v-for="font in FONT_FAMILIES" :key="font.value" :value="font.value">
                {{ font.label }}
              </option>
            </select>
          </template>
        </FormField>

        <RangeField
          v-model="params.fontSize"
          :limit="LIMITS.fontSize"
          label="字体大小"
          :format="(value) => `${value} px`"
        />

        <SwitchField v-model="params.bold" label="加粗" />
      </SectionCard>

      <SectionCard title="颜色与描边">
        <div class="flex items-center justify-between gap-3">
          <label for="param-color" class="text-xs font-medium tracking-wide text-muted">
            文本颜色
          </label>
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] uppercase text-faint">{{ params.color }}</span>
            <input
              id="param-color"
              v-model="params.color"
              type="color"
              class="h-8 w-10 rounded-lg border border-line bg-surface-2 p-0.5"
            />
          </div>
        </div>

        <div class="flex items-center justify-between gap-3">
          <label for="param-stroke-color" class="text-xs font-medium tracking-wide text-muted">
            描边颜色
          </label>
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] uppercase text-faint">{{ params.strokeColor }}</span>
            <input
              id="param-stroke-color"
              v-model="params.strokeColor"
              type="color"
              class="h-8 w-10 rounded-lg border border-line bg-surface-2 p-0.5"
            />
          </div>
        </div>

        <RangeField
          v-model="params.strokeWidth"
          :limit="LIMITS.strokeWidth"
          label="描边宽度"
          :format="(value) => `${value} px`"
        />
      </SectionCard>

      <SectionCard title="排版">
        <RangeField
          v-model="params.opacity"
          :limit="LIMITS.opacity"
          label="透明度"
          :format="(value) => value.toFixed(2)"
        />
        <RangeField
          v-model="params.angle"
          :limit="LIMITS.angle"
          label="旋转角度"
          :format="(value) => `${value}°`"
        />
        <RangeField
          v-model="params.gapX"
          :limit="LIMITS.gapX"
          label="水平间距"
          :format="(value) => `${value} px`"
        />
        <RangeField
          v-model="params.gapY"
          :limit="LIMITS.gapY"
          label="垂直间距"
          :format="(value) => `${value} px`"
        />
      </SectionCard>

      <SectionCard title="盲水印">
        <SwitchField
          v-model="params.blindEnabled"
          label="嵌入盲水印"
          hint="把文本写入频域，肉眼不可见；导出格式锁定为 PNG"
        />

        <template v-if="params.blindEnabled">
          <FormField label="盲水印文本" hint="最长 64 字符，UTF-8 编码后不超过 200 字节">
            <template #aside>
              <span
                class="font-mono text-[11px]"
                :class="blindTooLong ? 'text-danger' : 'text-faint'"
              >
                {{ params.blindText.length }}/{{ BLIND_TEXT_MAX_LENGTH }} 字 ·
                {{ blindBytes }}/{{ BLIND_MAX_BYTES }} B
              </span>
            </template>
            <template #default="{ id }">
              <input
                :id="id"
                v-model="params.blindText"
                type="text"
                :maxlength="BLIND_TEXT_MAX_LENGTH"
                spellcheck="false"
                class="field"
                placeholder="如：版权归属-张三"
              />
            </template>
          </FormField>

          <RangeField
            v-model="params.blindStrength"
            :limit="LIMITS.blindStrength"
            label="嵌入强度"
            :format="(value) => value.toFixed(1)"
          />

          <p class="rounded-lg bg-surface-2 p-2.5 text-[11px] leading-relaxed text-faint">
            强度为空间波纹幅度下限（灰度级），越大越鲁棒、越可能被看出，建议 1.5–3。
            图片任一边小于 {{ BLIND_MIN_SIZE }} 像素时无法嵌入。同一张图请勿重复嵌入。
          </p>

          <p v-if="blindEmpty" class="text-[11px] leading-relaxed text-warning">
            盲水印文本为空，导出时不会嵌入盲水印。
          </p>
          <p v-else-if="blindTooLong" class="text-[11px] leading-relaxed text-danger">
            文本超过 200 字节，请缩短后再导出。
          </p>
        </template>
      </SectionCard>

      <SectionCard title="导出">
        <FormField label="图片格式">
          <template #default="{ id }">
            <select
              :id="id"
              class="field disabled:opacity-60"
              :disabled="params.blindEnabled"
              :value="params.format"
              @change="setFormat(($event.target as HTMLSelectElement).value)"
            >
              <option value="png">PNG（无损）</option>
              <option value="jpeg">JPEG</option>
            </select>
          </template>
          <template #aside>
            <span v-if="params.blindEnabled" class="flex items-center gap-1 text-[11px] text-faint">
              <AppIcon name="lock" :size="12" />
              已锁定
            </span>
          </template>
        </FormField>

        <p v-if="params.blindEnabled" class="text-[11px] leading-relaxed text-faint">
          盲水印已启用，为了保持频域数据完整，导出格式固定为无损 PNG。
        </p>

        <RangeField
          v-if="!params.blindEnabled && params.format === 'jpeg'"
          v-model="params.quality"
          :limit="LIMITS.quality"
          label="JPEG 质量"
          :format="(value) => value.toFixed(2)"
        />
      </SectionCard>
    </div>

    <div class="border-t border-line px-4 py-3">
      <button type="button" class="btn btn-ghost w-full" @click="resetAll">
        <AppIcon name="rotate" :size="15" />
        恢复默认参数
      </button>
    </div>
  </aside>
</template>
