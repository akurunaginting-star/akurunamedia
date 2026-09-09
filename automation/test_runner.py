import copy
from datetime import datetime, timezone
import io
import unittest
from unittest.mock import patch
from PIL import Image
import run

SOURCE='Bitcoin trading volume decreased according to the exchange. Open interest remained stable during the reporting period.'
ARTICLE={'title':'Aktivitas Bitcoin Melambat','headline':'Aktivitas Bitcoin Melambat, Posisi Pedagang Tetap Stabil','excerpt':'Ringkasan berita.','caption':'Volume perdagangan Bitcoin menurun menurut bursa.','image_prompt':'A symbolic bitcoin coin with emerald light.','paragraphs':['Volume perdagangan menurun.'],'evidence':[{'claim':'Volume menurun','quote':'Bitcoin trading volume decreased according to the exchange.'},{'claim':'Posisi stabil','quote':'Open interest remained stable during the reporting period.'}]}

class TestRunner(unittest.TestCase):
    def test_provenance_and_caption(self):
        result=run.validate_generated(copy.deepcopy(ARTICLE),SOURCE,'Ilustrasi AI')
        self.assertTrue(result['caption'].endswith('Ilustrasi AI'))
        bad=copy.deepcopy(ARTICLE);bad['evidence'][0]['quote']='This evidence was never in the source.'
        with self.assertRaises(run.JobError):run.validate_generated(bad,SOURCE,'')
        bad=copy.deepcopy(ARTICLE);bad['caption']='X'*1501
        with self.assertRaises(run.JobError):run.validate_generated(bad,SOURCE,'')

    def test_source_network_boundary(self):
        with patch.object(run.SESSION,'get') as get:
            with self.assertRaises(run.JobError):run.source_get('https://localhost/secret',['www.coindesk.com'])
            get.assert_not_called()
        for url in ['http://www.coindesk.com/a','https://name:password@www.coindesk.com/a']:
            with self.assertRaises(run.JobError):run.canonical(url)
        self.assertEqual(run.canonical('https://www.coindesk.com/a?utm_source=x#top'),'https://www.coindesk.com/a')

    def test_freshness(self):
        feed=b'''<rss version="2.0"><channel><title>Test</title><item><title>Bitcoin fresh</title><link>https://www.coindesk.com/fresh</link><pubDate>Wed, 09 Sep 2026 00:00:00 GMT</pubDate></item><item><title>Bitcoin old</title><link>https://www.coindesk.com/old</link><pubDate>Wed, 01 Jan 2020 00:00:00 GMT</pubDate></item><item><title>Bitcoin no date</title><link>https://www.coindesk.com/no-date</link></item></channel></rss>'''
        config={'feeds':['https://www.coindesk.com/rss'],'source_hosts':['www.coindesk.com'],'keywords':['bitcoin'],'exclude_keywords':['sponsored'],'max_age_hours':24}
        with patch.object(run,'source_get',return_value=feed):
            result=run.candidates(config,datetime(2026,9,9,12,tzinfo=timezone.utc).timestamp())
        self.assertEqual([x['title'] for x in result],['Bitcoin fresh'])

    def test_layout_long_title(self):
        buf=io.BytesIO();Image.new('RGB',(1024,1024),'#123529').save(buf,'JPEG')
        for title in [ARTICLE['headline'],'Bitcoin Tetap Sensitif terhadap Data Makro AS di Tengah Perubahan Narasi Pasar Derivatif']:
            rendered=run.render(buf.getvalue(),title)
            image=Image.open(io.BytesIO(rendered));self.assertEqual(image.size,(1080,1080));self.assertEqual(image.format,'JPEG')
        with self.assertRaises(run.JobError):run.render(buf.getvalue(),'A'*200)

    def test_run_uses_separate_caption_and_generated_image(self):
        config={'feeds':[],'text_model':'test','caption_footer':'test'}
        # Test orchestration with every external operation mocked; no paid calls or real posting.
        a={**copy.deepcopy(ARTICLE),'approved':True,'review_notes':'Lolos'}
        item={'url':'https://www.coindesk.com/test','published':'2026-09-09','feed_text':SOURCE}
        calls=[]
        def bridge(action,**kwargs):
            calls.append((action,kwargs))
            return {'mode':'draft'} if action=='inspect' else {'reserved':True,'id':'f'*64} if action=='reserve' else {'state':'draft'}
        with patch('sys.argv',['run.py','--mode','draft']),patch.dict(run.os.environ,{'OPENAI_API_KEY':'test'}),patch.object(run,'bridge',side_effect=bridge),patch.object(run,'candidates',return_value=[item]),patch.object(run,'article_text',return_value=SOURCE),patch.object(run,'write_article',return_value=a),patch.object(run,'generate_background',return_value=b'AI'),patch.object(run,'render',return_value=b'JPEG'),patch.object(run,'save_report'),patch.object(run.Path,'write_bytes'),patch.object(run.Path,'write_text'):
            run.main()
        self.assertEqual([x[0] for x in calls],['inspect','reserve','upload','save'])
        self.assertTrue(calls[1][1]['draft'])
        self.assertEqual(calls[-1][1]['article']['caption'],a['caption'])

if __name__=='__main__':unittest.main()
