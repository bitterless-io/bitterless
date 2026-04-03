import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import moment from 'moment';

type ContainerUnit = 'year' | 'month' | 'week' | 'day';

const FORMAT_MAP: Record<string, string> = {
  year: 'YYYY年',
  month: 'YYYY年MM月',
  week: 'YYYY年 第ww周',
  day: 'YYYY年MM月DD日',
};

export const getDateSkill = tool(
  async ({
    containerOffset,
    containerUnit,
    targetMonth,
    targetDay,
    targetWeekday,
  }: {
    containerOffset: number;
    containerUnit: ContainerUnit;
    targetMonth?: number;
    targetDay?: number;
    targetWeekday?: number;
  }) => {
    console.log('[skill] get_date', { containerOffset, containerUnit, targetMonth, targetDay, targetWeekday });

    try {
      let target = moment();

      // Phase 1: jump to the target container
      if (containerOffset !== 0) {
        if (containerOffset > 0) {
          target = target.add(containerOffset, containerUnit);
        } else {
          target = target.subtract(Math.abs(containerOffset), containerUnit);
        }
      }

      // Phase 2: navigate within the container
      if (targetMonth !== undefined) {
        target = target.month(targetMonth - 1);
      }
      if (targetDay !== undefined) {
        target = target.date(targetDay);
      }
      if (targetWeekday !== undefined) {
        // isoWeekday: 1=Mon, 2=Tue, ..., 7=Sun (Monday-based)
        // targetWeekday input: 0=Sun, 1=Mon, ..., 6=Sat
        const isoTarget = targetWeekday === 0 ? 7 : targetWeekday;
        target = target.isoWeekday(isoTarget);
      }

      // Determine readable format precision
      let formatKey = containerUnit;
      if (targetDay !== undefined || targetWeekday !== undefined) {
        formatKey = 'day';
      } else if (targetMonth !== undefined) {
        formatKey = 'month';
      }
      const readableFormat = FORMAT_MAP[formatKey] ?? FORMAT_MAP['day'];

      return JSON.stringify({
        containerOffset,
        containerUnit,
        date: target.format('YYYY-MM-DD'),
        time: target.format('HH:mm:ss'),
        datetime: target.format('YYYY-MM-DD HH:mm:ss'),
        dateReadable: target.format(readableFormat),
        dayOfWeekCN: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][target.day()],
        timestamp: target.valueOf(),
        isoString: target.toISOString(),
      });
    } catch (err: any) {
      console.error('[skill] get_date error:', err.message);
      return JSON.stringify({ error: err.message });
    }
  },
  {
    name: 'get_date',
    description:
      'Get a specific single date/time point from a relative expression. ' +
      'Use this tool ONLY when the user refers to a specific date (e.g. 下周一, 明天, 本月15号), NOT a date range. ' +
      'If the user refers to a period (e.g. 下周, 本月, 今年), use get_date_range instead. ' +
      'IMPORTANT: If the user query contains a relative date expression but the exact date cannot be determined (e.g. user says "某天" or is ambiguous), ask the user to clarify the specific date before calling this tool. ' +
      'If the date is clear, call this tool first and use the returned "date" field (YYYY-MM-DD) in subsequent queries. Never guess or compute dates yourself. ' +
      'Examples: ' +
      '今天/today → offset:0 unit:day | ' +
      '明天/tomorrow → offset:1 unit:day | ' +
      '昨天/yesterday → offset:-1 unit:day | ' +
      '下周一/next Monday → offset:1 unit:week targetWeekday:1 | ' +
      '本周五/this Friday → offset:0 unit:week targetWeekday:5 | ' +
      '上周三/last Wednesday → offset:-1 unit:week targetWeekday:3 | ' +
      '下月1号/1st of next month → offset:1 unit:month targetDay:1 | ' +
      '本月15号/15th of this month → offset:0 unit:month targetDay:15 | ' +
      '明年一月/January next year → offset:1 unit:year targetMonth:1 | ' +
      '明年3月5号/Mar 5th next year → offset:1 unit:year targetMonth:3 targetDay:5 | ' +
      '去年12月/December last year → offset:-1 unit:year targetMonth:12',
    schema: z.object({
      containerOffset: z.number().describe(
        'Offset of the time container from now. 0=this(当前), 1=next(下/明), -1=last(上/昨/前)',
      ),
      containerUnit: z.enum(['year', 'month', 'week', 'day']).describe(
        'The container time unit: "year"(年), "month"(月), "week"(周/星期), "day"(天/日)',
      ),
      targetMonth: z.number().min(1).max(12).optional().describe(
        'Target month within the year (1-12). Only used when containerUnit is "year". E.g. 明年一月 → targetMonth:1',
      ),
      targetDay: z.number().min(1).max(31).optional().describe(
        'Target day-of-month (1-31). Used when containerUnit is "month" or "year". E.g. 下月1号 → targetDay:1',
      ),
      targetWeekday: z.number().min(0).max(6).optional().describe(
        'Target weekday (0=Sun周日, 1=Mon周一, 2=Tue周二, 3=Wed周三, 4=Thu周四, 5=Fri周五, 6=Sat周六). Only used when containerUnit is "week".',
      ),
    }),
  },
);
