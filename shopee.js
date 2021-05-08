const pw = require('playwright-core')
const XLSX = require('xlsx')
const crawlab = require('crawlab-sdk')
const events = require('events')
const cron = require('node-schedule')

const production = process.env.PRODUCTION
const parallel = process.env.PARALLEL ? process.env.PARALLEL : 1
const pageCount = process.env.PAGE ? process.env.PAGE : 3
const cron_identity = process.env.CRON

const save = process.env.SAVE

const myEmitter = new events.EventEmitter()
myEmitter.setMaxListeners(0)

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const readItemsTitle = () => {
  const workbook = XLSX.readFile('./products.xlsx')
  const first_sheet_name = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[first_sheet_name]
  const range = XLSX.utils.decode_range(worksheet['!ref'])

  const rows = [...Array(range.e.r).keys()].map((r) => {
    return worksheet[`B${r + 2}`].v
  })
  return rows
}

let bs = [],
  pages = []
let crawlCounter = 0

const init = async (paracount, pagecount) => {
  for (let i = 0; i < paracount; i++) {
    const b = await pw.chromium.launch({
      headless: !!production,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    })
    const context = await b.newContext()
    bs.push(b)
    for (let j = 0; j < pagecount; j++) {
      const page = await context.newPage()
      pages.push(page)
    }
  }

  console.log(
    `starting.... chrome instance count ${bs.length} and total pages count: ${pages.length}`
  )
}

const job = async (items, worker, p) => {
  let exit = false
  myEmitter.on('closed', function ({ sendWorker, sendPage }) {
    if (worker !== sendWorker || p !== sendPage) {
      exit = true
    }
  })

  const tryDo = async (titles) => {
    const page = pages[worker * pageCount + p]

    await page.goto(`https://shopee.com.my/`)

    let curIndex = 0

    try {
      for (const v of titles) {
        await crawler(page, v, worker, p)
        curIndex += 1
      }
    } catch (error) {
      for (const b of bs) {
        await b.close()
      }

      console.error(error)
      titles.splice(0, curIndex)
      console.log(
        `worker #${worker} page #${p}:`,
        '  extra titles length: ',
        titles.length
      )

      if (titles.length > 0) {
        if (!exit) {
          myEmitter.emit('closed', { sendWorker: worker, sendPage: p })
          bs = []
          pages = []
          await init(parallel, pageCount)
          myEmitter.emit('start')
        }
        await new Promise((resolve) => {
          myEmitter.on('start', async () => {
            exit = false
            await tryDo(titles)
            resolve(titles)
          })
        })
      }
    }
  }
  await tryDo(items)
}

const crawler = async (page, title, worker, p) => {
  const languageBtn = await page.$('#modal div.language-selection__list button')
  if (languageBtn) {
    await languageBtn.click()
  }

  const modalBtn = await page.$('.shopee-popup__close-btn')
  if (modalBtn) {
    await modalBtn.click()
  }

  await page.fill('.shopee-searchbar-input__input', title)
  const btn = await page.$('.btn.btn-solid-primary.btn--s.btn--inline')

  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes('backend/growth/canonical_search/get_url')
    ),
    btn.click(),
    page.waitForNavigation()
  ])

  const elementHandle = await Promise.race([
    page.waitForSelector('.shopee-search-empty-result-section'),
    page.waitForSelector('.shopee-search-item-result__items')
  ])
  const classNames = await elementHandle.getAttribute('class')
  const empty = classNames.includes('shopee-search-empty-result-section')
  if (empty) {
    console.log(`worker #${worker} page #${p}: not found ${title}`)
    return
  }

  await page.click('text=Top Sales')
  await autoScroll(page)

  const items = await page.$$(
    '.shopee-search-item-result__item div[data-sqe=name] > div:nth-child(1) div'
  )

  for (const item of items) {
    const t = await item.innerText()

    console.log(`worker #${worker} page #${p}:`, t)
    crawlCounter += 1
    console.log(`total crawl count: ${crawlCounter}`)

    if (!!save) {
      await crawlab.saveItem({ title: t })
    }
  }
}

const autoScroll = async (page) => {
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      var totalHeight = 0
      var distance = 100
      var timer = setInterval(() => {
        var scrollHeight = document.body.scrollHeight
        window.scrollBy(0, distance)
        totalHeight += distance

        if (totalHeight >= scrollHeight) {
          clearInterval(timer)
          resolve()
        }
      }, 100)
    })
  })
}

const items = readItemsTitle()

const totalCount = parallel * pageCount

const workers = async () => {
  await init(parallel, pageCount)

  return [...Array(totalCount).keys()].map((i) => {
    const tail =
      i === totalCount - 1
        ? items.length
        : (items.length * (i + 1)) / totalCount
    const currentParallel = parseInt(i / pageCount)
    const currentPage = i % pageCount

    return job(
      items.slice((items.length * i) / totalCount, tail),
      currentParallel,
      currentPage
    )
  })
}

const main = async () => {
  var datetime = new Date()
  console.log(datetime.toISOString())
  const doWorkers = await workers()
  await Promise.all(doWorkers)
  if (!!save) {
    await crawlab.close()
  }
  for (const b of bs) {
    await b.close()
  }
  console.log('crawler ending...')
}

if (cron_identity) {
  console.log(`crawler cron is ${cron_identity}`)
  cron.scheduleJob(cron_identity, main)
} else {
  console.log(`crawler run rightnow`)
  main()
}
