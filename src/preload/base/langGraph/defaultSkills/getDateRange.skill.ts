import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import moment from 'moment';

type ContainerUnit = 'year' | 'month' | 'week' | 'day';

export const getDateRangeSkill = tool(
  async ({
    containerOffset,
    containerUnit,
  }: {
    containerOffset: number;
    containerUnit: ContainerUnit;
  }) => {
    console.log('[skill] get_date_range', { containerOffset, containerUnit });

    try {
      let anchor = moment();

      // Use isoWeek for week unit to ensure Monday-based week (ISO 8601)
      const momentUnit = containerUnit === 'week' ? 'isoWeek' : containerUnit;

      if (containerOffset !== 0) {
        if (containerOffset > 0) {
          anchor = anchor.add(containerOffset, containerUnit);
        } else {
          anchor = anchor.subtract(Math.abs(containerOffset), containerUnit);
        }
      }

      const start = anchor.clone().startOf(momentUnit as moment.unitOfTime.StartOf);
      const end = anchor.clone().endOf(momentUnit as moment.unitOfTime.StartOf);

      return JSON.stringify({
        containerOffset,
        containerUnit,
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        startDatetime: start.format('YYYY-MM-DD HH:mm:ss'),
        endDatetime: end.format('YYYY-MM-DD HH:mm:ss'),
        startTimestamp: start.valueOf(),
        endTimestamp: end.valueOf(),
        startDayOfWeekCN: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][start.day()],
        endDayOfWeekCN: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][end.day()],
      });
    } catch (err: any) {
      console.error('[skill] get_date_range error:', err.message);
      return JSON.stringify({ error: err.message });
    }
  },
  {
    name: 'get_date_range',
    description:
      'Get the start and end date of a relative time period (e.g. 下周, 本月, 今年). ' +
      'Use this tool when the user refers to a time span/period, NOT a specific date. ' +
      'If the user refers to a specific date (e.g. 下周一, 明天, 本月15号), use get_date instead. ' +
      'IMPORTANT: If the time period is ambiguous or cannot be determined from context (e.g. user says "某个时间段" without specifying which), ask the user to clarify the period before calling this tool. ' +
      'Always call this tool for period expressions — never compute date ranges yourself. ' +
      'Use the returned "startDate" and "endDate" (YYYY-MM-DD) in subsequent queries. ' +
      'Examples: ' +
      '本周/this week → offset:0 unit:week | ' +
      '下周/next week → offset:1 unit:week | ' +
      '上周/last week → offset:-1 unit:week | ' +
      '本月/this month → offset:0 unit:month | ' +
      '下个月/next month → offset:1 unit:month | ' +
      '上个月/last month → offset:-1 unit:month | ' +
      '今年/this year → offset:0 unit:year | ' +
      '明年/next year → offset:1 unit:year | ' +
      '去年/last year → offset:-1 unit:year | ' +
      '今天/today (full day range) → offset:0 unit:day | ' +
      '明天/tomorrow → offset:1 unit:day | ' +
      '昨天/yesterday → offset:-1 unit:day',
    schema: z.object({
      containerOffset: z.number().describe(
        'Offset of the time period from now. 0=this(本/今), 1=next(下/明), -1=last(上/昨/去)',
      ),
      containerUnit: z.enum(['year', 'month', 'week', 'day']).describe(
        'The time period unit: "year"(年), "month"(月), "week"(周/星期), "day"(天/日)',
      ),
    }),
  },
);
